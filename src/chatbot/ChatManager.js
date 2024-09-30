// src/chatbot/ChatManager.js
import OpenAI from 'openai';
import { OPENAI_API_KEY } from '../config';
import { prepareBitcoinTransaction } from '../background';
import { getMinFee } from '../utils/fee';
import { getFeeRates } from '../services/bitcoinService';

class ChatManager {
        constructor(apiKey, getBalanceFunction, sendTransactionFunction, prepareTransactionFunction) {
                this.messages = [];
                this.apiKey = apiKey;
                this.getBalance = getBalanceFunction;
                this.requestQueue = [];
                this.isProcessingQueue = false;
                this.lastRequestTime = 0;
                this.minRequestInterval = 10000; // Minimum 10 seconds between requests
                this.baseDelay = 5000; // Start with 5 second delay
                this.maxDelay = 300000; // Maximum delay of 5 minutes
                this.currentDelay = this.baseDelay;
                this.maxRetries = 1; // Maximum number of retries

                this.prepareTransaction = prepareTransactionFunction;
                this.sendTransaction = sendTransactionFunction;
                this.pendingTransaction = null;

                this.contacts = [];
                this.loadContacts();
        }

        async loadContacts() {
                return new Promise((resolve) => {
                        chrome.storage.local.get(['contacts'], (result) => {
                                this.contacts = result.contacts || [];
                                resolve(this.contacts);
                        });
                });
        }

        async loadMessages() {
                return new Promise((resolve) => {
                        chrome.storage.local.get(['chatMessages'], (result) => {
                                this.messages = result.chatMessages || [];
                                resolve(this.messages);
                        });
                });
        }

        async addMessage(message) {
                this.messages.push(message);
                return new Promise((resolve) => {
                        chrome.storage.local.set({ chatMessages: this.messages }, () => {
                                resolve();
                        });
                });
        }

        getMessages() {
                return this.messages;
        }

        async generateBotResponse(userInput) {
                return new Promise((resolve, reject) => {
                        this.requestQueue.push({ userInput, resolve, reject });
                        if (!this.isProcessingQueue) {
                                this.processQueue();
                        }
                });
        }

        async processQueue() {
                if (this.requestQueue.length === 0) {
                        this.isProcessingQueue = false;
                        return;
                }

                this.isProcessingQueue = true;
                const { userInput, resolve, reject } = this.requestQueue[0];

                let retries = 0;
                while (retries < this.maxRetries) {
                        try {
                                const response = await this.makeOpenAIRequest(userInput);
                                const parsedResponse = JSON.parse(response);

                                this.requestQueue.shift(); // Remove the processed request
                                this.lastRequestTime = Date.now();
                                this.currentDelay = this.baseDelay; // Reset delay on success
                                resolve(JSON.stringify(parsedResponse, null, 2));
                                break;
                        } catch (error) {
                                if (error.message.includes('429')) {
                                        console.log(`Rate limited. Retrying in ${this.currentDelay / 1000} seconds. Attempt ${retries + 1}/${this.maxRetries}`);
                                        await new Promise(resolve => setTimeout(resolve, this.currentDelay));
                                        this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
                                        retries++;
                                } else {
                                        this.requestQueue.shift(); // Remove the failed request
                                        reject(error);
                                        break;
                                }
                        }
                }

                if (retries === this.maxRetries) {
                        console.log('Max retries reached. Using fallback response generator.');
                        const fallbackResponse = await this.generateFallbackResponse(userInput);
                        resolve(fallbackResponse);
                        this.requestQueue.shift(); // Remove the request after fallback
                }

                // Continue processing the queue
                setTimeout(() => this.processQueue(), 100);
        }

        async makeOpenAIRequest(userInput) {
                const context = `You are an AI assistant for a Bitcoin wallet extension.
        Parse the user's input for intent, amount, address, and fee rate related to Bitcoin transactions.
        Respond with a JSON object containing these fields. If any field is missing, use -1 as a placeholder.
        For fee rate, if not specified, fetch the current market rate.`;

                const prompt = `${context}\n\nUser input: ${userInput}\n\nGenerate a JSON response:`;

                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.apiKey}`
                        },
                        body: JSON.stringify({
                                model: "gpt-3.5-turbo",
                                messages: [{ role: "user", content: prompt }],
                                temperature: 0.7,
                                max_tokens: 150,
                        })
                });

                if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                return this.validateAndNormalizeResponse(data.choices[0].message.content.trim(), userInput);
        }

        async validateAndNormalizeResponse(aiResponse, userInput) {
                try {
                        let parsed = JSON.parse(aiResponse);
                        const currentBalance = await this.getBalance();
                        const feeRates = await getFeeRates();

                        // Choose fee rate based on transaction amount
                        let recommendedFeeRate;
                        if (parsed.amount < 10000) { // For small transactions (less than 10,000 satoshis)
                                recommendedFeeRate = feeRates.economyFee;
                        } else if (parsed.amount < 50000) { // For medium transactions
                                recommendedFeeRate = feeRates.hourFee;
                        } else { // For large transactions
                                recommendedFeeRate = feeRates.halfHourFee;
                        }

                        // Use the recommended fee rate, but ensure it's not lower than the minimum
                        parsed.feeRate = Math.max(recommendedFeeRate, feeRates.minimumFee);

                        if (parsed.intent === "BTC_TRANSFER") {
                                // Check if the toAddress is a contact username
                                if (parsed.toAddress.startsWith('@')) {
                                        const contactUsername = parsed.toAddress.substring(1);
                                        const contact = this.contacts.find(c => c.username.toLowerCase() === contactUsername.toLowerCase());
                                        if (contact) {
                                                parsed.toAddress = contact.address;
                                        } else {
                                                parsed.error = `Contact @${contactUsername} not found.`;
                                                return JSON.stringify(parsed, null, 2);
                                        }
                                }

                                if (parsed.amount > currentBalance) {
                                        parsed.intent = "INSUFFICIENT_FUNDS";
                                        parsed.error = `Insufficient funds. Your current balance is ${currentBalance} satoshis.`;
                                } else if (parsed.amount <= 0 || isNaN(parsed.amount)) {
                                        parsed.intent = "INVALID_AMOUNT";
                                        parsed.error = "Invalid amount specified.";
                                } else {
                                        // Prepare the transaction
                                        console.log('Preparing transaction:', { toAddress: parsed.toAddress, amount: parsed.amount, feeRate: parsed.feeRate });
                                        const preparedTx = await this.prepareTransaction(parsed.toAddress, parsed.amount, parsed.feeRate);
                                        console.log('Prepared transaction result:', preparedTx);
                                        if (preparedTx.success) {
                                                this.pendingTransaction = preparedTx;
                                                parsed.pendingTransaction = preparedTx;
                                                parsed.requiresConfirmation = true;
                                        } else {
                                                parsed.error = preparedTx.error;
                                        }
                                }
                        }

                        parsed.currentBalance = currentBalance;
                        parsed.feeRates = feeRates; // Include all fee rates in the response
                        return JSON.stringify(parsed, null, 2);
                } catch (error) {
                        console.error('Error parsing AI response:', error);
                        throw new Error('Failed to parse AI response');
                }
        }

        async prepareTransaction(toAddress, amount, feeRate) {
                console.log('Preparing transaction:', { toAddress, amount, feeRate });
                try {
                        const currentFeeRates = await getFeeRates();
                        const effectiveFeeRate = Math.max(feeRate || recommendedFeeRate, currentFeeRates.minimumFee, 1);
                        console.log(`Using effective fee rate: ${effectiveFeeRate}`);

                        const result = await new Promise((resolve, reject) => {
                                chrome.runtime.sendMessage({
                                        action: 'prepareBitcoinTransaction',
                                        toAddress: toAddress,
                                        amount: amount,
                                        feeRate: effectiveFeeRate
                                }, (response) => {
                                        if (chrome.runtime.lastError) {
                                                console.error('Chrome runtime error:', chrome.runtime.lastError);
                                                reject(new Error(chrome.runtime.lastError.message));
                                        } else {
                                                console.log('prepareBitcoinTransaction response:', response);
                                                resolve(response);
                                        }
                                });
                        });

                        console.log('Transaction preparation result:', result);
                        return result;
                } catch (error) {
                        console.error('Error in prepareTransaction:', error);
                        return { success: false, error: error.message };
                }
        }

        async confirmTransaction(pendingTransaction) {
                if (!pendingTransaction) {
                        return { success: false, error: 'No pending transaction to confirm' };
                }

                try {
                        const result = await this.sendTransaction(
                                pendingTransaction.toAddress,
                                pendingTransaction.amount,
                                pendingTransaction.feeRate,
                                pendingTransaction.psbtHex
                        );
                        this.pendingTransaction = null;
                        return result;
                } catch (error) {
                        console.error('Error confirming transaction:', error);
                        return { success: false, error: error.message };
                }
        }

        cancelTransaction() {
                this.pendingTransaction = null;
                return { success: true, message: 'Transaction cancelled' };
        }

        async sendTransaction(toAddress, amount, feeRate) {
                console.log('sendTransaction called with:', { toAddress, amount, feeRate });
                try {
                        const result = await new Promise((resolve, reject) => {
                                chrome.runtime.sendMessage({
                                        action: 'sendBitcoin',
                                        toAddress: toAddress,
                                        amount: amount,
                                        feeRate: feeRate
                                }, (response) => {
                                        if (chrome.runtime.lastError) {
                                                console.error('Chrome runtime error:', chrome.runtime.lastError);
                                                reject(new Error(chrome.runtime.lastError.message));
                                        } else {
                                                console.log('sendBitcoin response:', response);
                                                resolve(response);
                                        }
                                });
                        });

                        console.log('Transaction result:', result);

                        if (result.success) {
                                return { success: true, txid: result.txid };
                        } else {
                                return { success: false, error: result.error || 'Unknown error occurred' };
                        }
                } catch (error) {
                        console.error('Error in sendTransaction:', error);
                        return { success: false, error: error.message };
                }
        }

        async generateFallbackResponse(userInput) {
                console.log('Generating fallback response for input:', userInput);
                const words = userInput.toLowerCase().split(' ');
                let intent = "UNKNOWN";
                let amount = -1;
                let toAddress = "";
                let transactionResult = null;

                // Parse intent
                if (words.includes("send") || words.includes("transfer")) {
                        intent = "BTC_TRANSFER";
                } else if (words.includes("balance") || words.includes("check")) {
                        intent = "CHECK_BALANCE";
                }

                // Parse fee rate
                const feeRateIndex = words.findIndex(w => w.includes('sat/vb'));
                if (feeRateIndex !== -1) {
                        feeRate = parseFloat(words[feeRateIndex - 1]);
                }

                // Get current fee rates
                const currentFeeRates = await getFeeRates();
                console.log('Current fee rates:', currentFeeRates);

                // Choose fee rate based on transaction amount
                let feeRate;
                if (amount < 10000) {
                        feeRate = currentFeeRates.economyFee;
                } else if (amount < 50000) {
                        feeRate = currentFeeRates.hourFee;
                } else {
                        feeRate = currentFeeRates.halfHourFee;
                }

                // Ensure the fee rate is not lower than the minimum
                feeRate = Math.max(feeRate, currentFeeRates.minimumFee);
                console.log(`Using fee rate: ${feeRate}`);

                // Parse amount
                const amountIndex = words.findIndex(w => !isNaN(w));
                if (amountIndex !== -1) {
                        amount = parseFloat(words[amountIndex]);
                        // Convert to satoshis if the amount is in BTC
                        if (amount < 1) {
                                amount = Math.floor(amount * 100000000);
                        }
                }

                // Parse address or contact
                const atIndex = words.findIndex(w => w.startsWith('@'));
                if (atIndex !== -1) {
                        const contactName = words[atIndex].substring(1);
                        const contact = this.contacts.find(c => c.username.toLowerCase() === contactName.toLowerCase());
                        if (contact) {
                                toAddress = contact.address;
                        } else {
                                intent = "INVALID_CONTACT";
                        }
                } else {
                        toAddress = words.find(w => w.startsWith('tb1') || w.startsWith('bc1')) || "";
                }

                // Get current balance
                let currentBalance;
                try {
                        currentBalance = await this.getBalance();
                        console.log('Current balance:', currentBalance);
                } catch (balanceError) {
                        console.error('Error fetching balance:', balanceError);
                        currentBalance = 0;
                }

                // Validate transaction
                let error = null;
                if (intent === "BTC_TRANSFER") {
                        console.log('Validating BTC transfer:', { amount, toAddress, currentBalance, feeRate });
                        if (amount > currentBalance) {
                                intent = "INSUFFICIENT_FUNDS";
                                error = `Insufficient funds. Your current balance is ${currentBalance} satoshis.`;
                        } else if (amount <= 0 || isNaN(amount)) {
                                intent = "INVALID_AMOUNT";
                                error = "Invalid amount specified.";
                        } else if (!toAddress) {
                                intent = "INVALID_ADDRESS";
                                error = "Invalid or missing recipient address.";
                        } else {
                                // Prepare the transaction
                                try {
                                        console.log('Preparing transaction:', { toAddress, amount, feeRate });
                                        const preparedTx = await this.prepareTransaction(toAddress, amount, feeRate);
                                        console.log('Prepared transaction result:', preparedTx);
                                        if (preparedTx.success) {
                                                transactionResult = {
                                                        success: true,
                                                        pendingTransaction: preparedTx,
                                                        requiresConfirmation: true
                                                };
                                        } else {
                                                error = preparedTx.error || "Failed to prepare transaction.";
                                        }
                                } catch (txError) {
                                        console.error('Error preparing transaction:', txError);
                                        error = `Failed to prepare transaction: ${txError.message}`;
                                }
                        }
                }

                const response = {
                        intent: intent,
                        amount: amount,
                        toAddress: toAddress,
                        feeRate: feeRate,
                        feeRates: currentFeeRates,
                        currentBalance: currentBalance,
                        error: error,
                        transactionResult: transactionResult,
                        isFallbackResponse: true
                };

                console.log('Generated fallback response:', response);
                return JSON.stringify(response, null, 2);
        }

        async confirmAndSendTransaction(pendingTransaction) {
                if (!pendingTransaction) {
                        return { success: false, error: 'No pending transaction to confirm' };
                }

                try {
                        const result = await this.sendTransaction(
                                pendingTransaction.toAddress,
                                pendingTransaction.amount,
                                pendingTransaction.feeRate,
                                pendingTransaction.psbtHex
                        );
                        return result;
                } catch (error) {
                        console.error('Error confirming and sending transaction:', error);
                        return { success: false, error: error.message };
                }
        }

        async getCurrentFeeRate() {
                try {
                        const feeRates = await getFeeRates();
                        return feeRates.halfHourFee; // Or choose another fee rate based on your preference
                } catch (error) {
                        console.error('Error fetching fee rate:', error);
                        return 5; // Default to 5 sat/vB if unable to fetch
                }
        }
}

export default ChatManager;