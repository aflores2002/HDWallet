// src/chatbot/ChatManager
import OpenAI from 'openai';
import { OPENAI_API_KEY } from '../config';


class ChatManager {
        constructor(apiKey, getBalanceFunction, sendTransactionFunction) {
                this.messages = [];
                this.apiKey = apiKey;
                this.getBalance = getBalanceFunction;
                this.sendTransaction = sendTransactionFunction;
                this.requestQueue = [];
                this.isProcessingQueue = false;
                this.lastRequestTime = 0;
                this.minRequestInterval = 10000; // Minimum 10 seconds between requests
                this.baseDelay = 5000; // Start with 5 second delay
                this.maxDelay = 300000; // Maximum delay of 5 minutes
                this.currentDelay = this.baseDelay;
                this.maxRetries = 1; // Maximum number of retries
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
                                this.requestQueue.shift(); // Remove the processed request
                                this.lastRequestTime = Date.now();
                                this.currentDelay = this.baseDelay; // Reset delay on success
                                resolve(response);
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

                        // Fetch current balance
                        const currentBalance = await this.getBalance();

                        // Fetch current fee rate if not provided
                        if (parsed.feeRate === -1) {
                                parsed.feeRate = await this.getCurrentFeeRate();
                        }

                        // Validate transaction
                        if (parsed.intent === "BTC_TRANSFER") {
                                if (parsed.amount > currentBalance) {
                                        parsed.intent = "INSUFFICIENT_FUNDS";
                                        parsed.error = `Insufficient funds. Your current balance is ${currentBalance} satoshis.`;
                                } else if (parsed.amount <= 0 || isNaN(parsed.amount)) {
                                        parsed.intent = "INVALID_AMOUNT";
                                        parsed.error = "Invalid amount specified.";
                                }
                        }

                        parsed.currentBalance = currentBalance;

                        return JSON.stringify(parsed, null, 2);
                } catch (error) {
                        console.error('Error parsing AI response:', error);
                        throw new Error('Failed to parse AI response');
                }
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

        async getCurrentFeeRate() {
                try {
                        const response = await fetch('https://mempool.space/api/v1/fees/recommended');
                        const data = await response.json();
                        return data.fastestFee; // Returns satoshis per vbyte
                } catch (error) {
                        console.error('Error fetching fee rate:', error);
                        return 5; // Default to 5 sat/vB if unable to fetch
                }
        }

        async generateFallbackResponse(userInput) {
                console.log('Generating fallback response for input:', userInput);
                const words = userInput.toLowerCase().split(' ');
                let intent = "UNKNOWN";
                let amount = -1;
                let toAddress = "";
                let feeRate = -1;
                let transactionResult = null;

                // Parse intent
                if (words.includes("send") || words.includes("transfer")) {
                        intent = "BTC_TRANSFER";
                } else if (words.includes("balance") || words.includes("check")) {
                        intent = "CHECK_BALANCE";
                }

                // Parse amount
                const amountIndex = words.findIndex(w => !isNaN(w));
                if (amountIndex !== -1) {
                        amount = parseFloat(words[amountIndex]);
                        // Convert to satoshis if the amount is in BTC
                        if (amount < 1) {
                                amount = Math.floor(amount * 100000000);
                        }
                }

                // Parse address
                toAddress = words.find(w => w.startsWith('tb1') || w.startsWith('bc1')) || "";

                // Get current balance
                let currentBalance;
                try {
                        currentBalance = await this.getBalance();
                        console.log('Current balance:', currentBalance);
                } catch (balanceError) {
                        console.error('Error fetching balance:', balanceError);
                        currentBalance = 0;
                }

                // Get current fee rate
                try {
                        feeRate = await this.getCurrentFeeRate();
                        console.log('Current fee rate:', feeRate);
                } catch (feeRateError) {
                        console.error('Error fetching fee rate:', feeRateError);
                        feeRate = -1;
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
                                // Attempt to send the transaction
                                try {
                                        console.log('Attempting to send transaction:', { toAddress, amount, feeRate });
                                        transactionResult = await this.sendTransaction(toAddress, amount, feeRate);
                                        console.log('Transaction result:', transactionResult);
                                        if (transactionResult.success) {
                                                error = null;
                                        } else {
                                                error = transactionResult.error || "Transaction failed for unknown reason.";
                                        }
                                } catch (txError) {
                                        console.error('Error during transaction:', txError);
                                        error = `Transaction failed: ${txError.message}`;
                                        transactionResult = { success: false, error: error };
                                }
                        }
                }

                const response = {
                        intent: intent,
                        amount: amount,
                        toAddress: toAddress,
                        feeRate: feeRate,
                        currentBalance: currentBalance,
                        error: error,
                        transactionResult: transactionResult,
                        isFallbackResponse: true
                };

                console.log('Generated fallback response:', response);
                return JSON.stringify(response, null, 2);
        }
}

export default ChatManager;