// src/background.js
import { generateMnemonic, walletFromSeedPhrase } from './wallet';
import { signMessage, verifyMessage } from './MessageSigning';
import { createPsbt, signPsbt, broadcastTransaction, rejectPsbt, resetUtxoState } from './PsbtService.js';
import { generateTransferPsbt } from './psbtGenerator';
import { getMinFee } from './utils/fee';
import CryptoJS from 'crypto-js';
import { derivePublicKey } from './utils/cryptoUtils';
import { getPaymentUtxos } from './PsbtService';
import { Buffer } from 'buffer';
import crypto from 'crypto-browserify';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);

let contentScriptReady = false;

// Listen for content script loaded message
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'CONTENT_SCRIPT_LOADED') {
                console.log('Content script loaded in tab:', sender.tab.id);
                contentScriptReady = true;
        }
});

// manage session timeout
let sessionTimeout = null;

if (chrome.alarms) {
        chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
        chrome.alarms.onAlarm.addListener((alarm) => {
                if (alarm.name === 'keepAlive') {
                        extendSession();
                }
        });
} else {
        console.warn('Alarms API is not available');
}

// Function to create a new wallet
async function createWallet() {
        const mnemonic = generateMnemonic();
        try {
                const wallet = await walletFromSeedPhrase({ mnemonic, index: 0, network: 'Testnet' });
                console.log('Created wallet:', wallet);
                return wallet;
        } catch (error) {
                console.error('Error creating wallet:', error);
                throw error;
        }
}

// Function to get balance
const CACHE_DURATION = 60000; // 1 minute in milliseconds
let balanceCache = {};

async function getBalance(address, retries = 3, initialDelay = 1000) {
        console.log(`getBalance called for address: ${address}`);

        // Check cache first
        if (balanceCache[address] && (Date.now() - balanceCache[address].timestamp) < CACHE_DURATION) {
                console.log('Returning cached balance');
                return balanceCache[address].data;
        }

        let delay = initialDelay;
        for (let i = 0; i < retries; i++) {
                try {
                        const response = await fetch(`https://blockstream.info/testnet/api/address/${address}`);
                        if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const data = await response.json();
                        console.log('Balance data received:', data);
                        const balanceInBTC = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 100000000; // Convert satoshis to BTC
                        const result = { success: true, balance: balanceInBTC };

                        // Cache the result
                        balanceCache[address] = {
                                data: result,
                                timestamp: Date.now()
                        };

                        return result;
                } catch (error) {
                        console.error(`Error fetching balance (attempt ${i + 1}/${retries}):`, error);
                        if (i === retries - 1) {
                                return { success: false, error: error.message };
                        }
                        await new Promise(resolve => setTimeout(resolve, delay));
                        delay *= 2; // Exponential backoff
                }
        }
        return { success: false, error: 'Max retries reached' };
}

async function handleGetBalance(address) {
        try {
                const balance = await getBalance(address);
                return balance;
        } catch (error) {
                console.error('Error in handleGetBalance:', error);
                return { success: false, error: error.message };
        }
}

function encryptWallet(wallet, password) {
        console.log('Encrypting wallet:', JSON.stringify(wallet));
        if (!wallet || !wallet.mnemonic || !wallet.wif) {
                console.error('Invalid wallet data for encryption');
                return { success: false, error: 'Invalid wallet data' };
        }
        try {
                console.log('Encrypting mnemonic...');
                const encryptedMnemonic = CryptoJS.AES.encrypt(wallet.mnemonic, password).toString();
                console.log('Mnemonic encrypted successfully');

                console.log('Encrypting WIF...');
                const encryptedWIF = CryptoJS.AES.encrypt(wallet.wif, password).toString();
                console.log('WIF encrypted successfully');

                console.log('Encryption complete');
                return {
                        success: true,
                        encryptedWallet: {
                                encryptedMnemonic,
                                encryptedWIF,
                                address: wallet.address
                        }
                };
        } catch (error) {
                console.error('Encryption failed:', error);
                return { success: false, error: 'Encryption failed: ' + error.message };
        }
}

function decryptWallet(encryptedWallet, password) {
        console.log('Attempting to decrypt wallet:', JSON.stringify(encryptedWallet));
        if (!encryptedWallet || !encryptedWallet.encryptedMnemonic || !encryptedWallet.encryptedWIF) {
                console.error('Invalid encrypted wallet data');
                return { success: false, error: 'Invalid wallet data' };
        }
        try {
                console.log('Decrypting mnemonic...');
                const decryptedMnemonic = CryptoJS.AES.decrypt(encryptedWallet.encryptedMnemonic, password).toString(CryptoJS.enc.Utf8);
                if (!decryptedMnemonic) {
                        throw new Error('Failed to decrypt mnemonic');
                }
                console.log('Mnemonic decrypted successfully');

                console.log('Decrypting WIF...');
                const decryptedWIF = CryptoJS.AES.decrypt(encryptedWallet.encryptedWIF, password).toString(CryptoJS.enc.Utf8);
                if (!decryptedWIF) {
                        throw new Error('Failed to decrypt WIF');
                }
                console.log('WIF decrypted successfully');

                // Derive public key from WIF
                const publicKey = derivePublicKey(decryptedWIF);

                return {
                        success: true,
                        wallet: {
                                mnemonic: decryptedMnemonic,
                                wif: decryptedWIF,
                                address: encryptedWallet.address,
                                publicKey: publicKey
                        }
                };
        } catch (error) {
                console.error('Decryption failed:', error);
                return { success: false, error: 'Decryption failed: ' + error.message };
        }
}

function setSession(wallets, currentWallet, password) {
        chrome.storage.local.set({
                sessionWallets: wallets,
                sessionCurrentWallet: currentWallet,
                sessionPassword: password
        }, () => {
                console.log('Session stored');
        });

        // Clear any existing timeout
        if (sessionTimeout) {
                clearTimeout(sessionTimeout);
        }

        // Set a new timeout for 30 minutes (1800000 ms)
        sessionTimeout = setTimeout(clearSession, 1800000);
}

function clearSession() {
        chrome.storage.local.remove(['sessionWallets', 'sessionCurrentWallet', 'sessionPassword'], () => {
                console.log('Session cleared');
        });
}

function extendSession() {
        chrome.storage.local.get(['sessionWallets', 'sessionCurrentWallet', 'sessionPassword'], (result) => {
                if (result.sessionWallets && result.sessionCurrentWallet && result.sessionPassword) {
                        setSession(result.sessionWallets, result.sessionCurrentWallet, result.sessionPassword);
                }
        });
}

// Add this message listener in your background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.contentScriptQuery == "fetchBalance") {
                fetch(request.url)
                        .then(response => response.json())
                        .then(data => sendResponse(data))
                        .catch(error => sendResponse({ error: error.toString() }));
                return true;  // Will respond asynchronously
        }
});

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        handleMessage(request, sender)
                .then(response => {
                        console.log('Sending response:', response);
                        sendResponse(response);
                })
                .catch(error => {
                        console.error('Error handling message:', error);
                        sendResponse({ success: false, error: error.message });
                });
        return true;  // Indicates that the response is sent asynchronously
});

// Function to get the current wallet
function getCurrentWallet() {
        return new Promise((resolve, reject) => {
                chrome.storage.local.get(['sessionCurrentWallet'], (result) => {
                        if (result.sessionCurrentWallet) {
                                resolve(result.sessionCurrentWallet);
                        } else {
                                reject(new Error("No current wallet available"));
                        }
                });
        });
}
// Function to get the current wallet address
async function getCurrentAddress() {
        try {
                const currentWallet = await getCurrentWallet();
                return { success: true, address: currentWallet.address };
        } catch (error) {
                console.error('Error getting current wallet address:', error);
                return { success: false, error: error.message };
        }
}

async function handleCreatePSBT(senderAddress, recipientAddress, amountInSatoshis, feeRate = 1) {
        try {
                console.log('handleCreatePSBT called with params:', { senderAddress, recipientAddress, amountInSatoshis, feeRate });
                const { psbtHex, usedUtxos } = await createPsbt(senderAddress, recipientAddress, amountInSatoshis, feeRate);

                // Store the used UTXOs temporarily
                await chrome.storage.local.set({ tempReservedUtxos: usedUtxos });

                console.log('PSBT created and UTXOs reserved:', { psbtHex, usedUtxos });
                return { success: true, psbtHex };
        } catch (error) {
                console.error('Error creating PSBT:', error);
                return { success: false, error: error.message };
        }
}

async function handleSignPsbt(request) {
        try {
                const psbtHex = request.params[0];
                if (!psbtHex || typeof psbtHex !== 'string') {
                        throw new Error("Invalid PSBT provided for signing");
                }

                const userConfirmation = await showConfirmationDialog({
                        type: 'signPSBT',
                        psbtHex: psbtHex
                });

                console.log('User confirmation result for PSBT signing:', userConfirmation);

                if (!userConfirmation || !userConfirmation.confirmed) {
                        console.log('User rejected the request');
                        return await handleRejectPSBT({ psbtHex });
                }

                console.log('User confirmed, proceeding with PSBT signing');
                const currentWallet = await getCurrentWallet();
                if (currentWallet && currentWallet.wif) {
                        const signedPsbtHex = signPsbt(psbtHex, currentWallet.wif);
                        console.log('PSBT signed successfully');
                        return { success: true, signedPsbtHex: signedPsbtHex };
                } else {
                        throw new Error("No wallet available");
                }
        } catch (error) {
                console.error('Error signing PSBT:', error);
                return { success: false, error: error.message };
        }
}

async function handleRejectPSBT(request) {
        console.log('Handling PSBT rejection');
        try {
                const psbtHex = request.params ? request.params[0] : request.psbtHex;
                if (!psbtHex) {
                        console.warn('No PSBT provided for rejection, releasing all reserved UTXOs');
                        await chrome.storage.local.remove('tempReservedUtxos');
                        return {
                                success: true,
                                message: "No PSBT to reject, all reserved UTXOs released"
                        };
                }
                await rejectPsbt(psbtHex);
                await chrome.storage.local.remove('tempReservedUtxos');
                console.log('PSBT rejected and UTXOs released');
                return {
                        success: true,
                        message: "PSBT rejected and UTXOs released"
                };
        } catch (error) {
                console.error('Error rejecting PSBT:', error);
                // Attempt to release UTXOs even if there's an error
                await chrome.storage.local.remove('tempReservedUtxos');
                return {
                        success: false,
                        error: `Error rejecting PSBT: ${error.message}`
                };
        }
}

async function handleBroadcastPSBT(request) {
        try {
                console.log('handleBroadcastPSBT received request:', request);
                let psbtHex;
                if (request.params && Array.isArray(request.params) && request.params.length > 0) {
                        psbtHex = request.params[0];
                } else if (request.psbtHex) {
                        psbtHex = request.psbtHex;
                }
                console.log('Extracted psbtHex:', psbtHex);

                if (!psbtHex || typeof psbtHex !== 'string') {
                        throw new Error('No valid PSBT provided for broadcasting');
                }
                const result = await broadcastTransaction(psbtHex);
                if (result.success) {
                        // Clear the reserved UTXOs after successful broadcast
                        await chrome.storage.local.remove('tempReservedUtxos');
                        console.log('Transaction broadcast successfully, UTXOs cleared');
                        return {
                                type: "FROM_EXTENSION",
                                action: "PSBT_BROADCASTED",
                                success: true,
                                txid: result.txid
                        };
                } else {
                        throw new Error(result.error);
                }
        } catch (error) {
                console.error('Error broadcasting PSBT:', error);
                return await handleRejectPSBT(request);
        }
}

async function handleEncryptWallet(request) {
        if (!request.wallet || !request.password) {
                throw new Error('Invalid wallet data or password');
        }
        const encryptionResult = encryptWallet(request.wallet, request.password);
        if (!encryptionResult.success) {
                throw new Error(encryptionResult.error);
        }
        return new Promise((resolve, reject) => {
                chrome.storage.local.get(['wallets'], (result) => {
                        let wallets = result.wallets || [];
                        wallets.push(encryptionResult.encryptedWallet);
                        chrome.storage.local.set({ wallets }, () => {
                                if (chrome.runtime.lastError) {
                                        reject(new Error(chrome.runtime.lastError.message));
                                } else {
                                        resolve({ success: true, encryptedWallet: encryptionResult.encryptedWallet });
                                }
                        });
                });
        });
}

async function handleDecryptWallets(request) {
        return new Promise((resolve, reject) => {
                chrome.storage.local.get(['wallets'], (result) => {
                        if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                                return;
                        }
                        const wallets = result.wallets || [];
                        if (wallets.length === 0) {
                                reject(new Error('No wallets found'));
                                return;
                        }
                        const decryptionResults = wallets.map(w => decryptWallet(w, request.password));
                        const decryptedWallets = decryptionResults.filter(r => r.success).map(r => r.wallet);
                        if (decryptedWallets.length === 0) {
                                const errors = decryptionResults.map(r => r.error).join('; ');
                                reject(new Error('Failed to decrypt any wallets: ' + errors));
                        } else {
                                resolve({ success: true, wallets: decryptedWallets });
                        }
                });
        });
}

async function handleGetSession() {
        return new Promise((resolve) => {
                chrome.storage.local.get(['sessionWallets', 'sessionCurrentWallet', 'sessionPassword'], (result) => {
                        if (result.sessionWallets && result.sessionCurrentWallet && result.sessionPassword) {
                                extendSession();
                                resolve({
                                        success: true,
                                        wallets: result.sessionWallets,
                                        currentWallet: result.sessionCurrentWallet,
                                        password: result.sessionPassword
                                });
                        } else {
                                resolve({ success: false });
                        }
                });
        });
}

async function handleSignMessage(request) {
        try {
                console.log('handleSignMessage request:', request);  // Add this line for debugging

                let message;
                if (request.params && request.params.length > 0) {
                        message = request.params[0];
                } else if (request.message) {
                        message = request.message;
                } else {
                        throw new Error("No message provided for signing");
                }

                const userConfirmation = await showConfirmationDialog({
                        type: 'signMessage',
                        message: message
                });
                console.log('User confirmation result:', userConfirmation);

                if (!userConfirmation || !userConfirmation.confirmed) {
                        console.log('User rejected the request');
                        return { success: false, message: "User rejected the request" };
                }

                console.log('User confirmed, proceeding with message signing');
                const currentWallet = await getCurrentWallet();
                if (currentWallet && currentWallet.wif) {
                        const signature = signMessage(message, currentWallet.wif);
                        console.log('Message signed, signature:', signature);
                        return {
                                success: true,
                                signature: signature,
                                address: currentWallet.address
                        };
                } else {
                        throw new Error("No wallet available");
                }
        } catch (error) {
                console.error('Error signing message:', error);
                return { success: false, error: error.message };
        }
}


async function showConfirmationDialog(request) {
        return new Promise((resolve, reject) => {
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                        if (chrome.runtime.lastError) {
                                console.error('Error querying tabs:', chrome.runtime.lastError);
                                reject(new Error('Error querying tabs'));
                                return;
                        }
                        if (tabs.length === 0) {
                                console.error('No active tab found');
                                reject(new Error('No active tab found'));
                                return;
                        }
                        const activeTab = tabs[0];
                        chrome.tabs.sendMessage(activeTab.id, {
                                action: "showConfirmation",
                                request: request
                        }, function (response) {
                                if (chrome.runtime.lastError) {
                                        console.error('Error sending message to content script:', chrome.runtime.lastError);
                                        reject(new Error('Error sending message to content script'));
                                } else {
                                        console.log('Confirmation dialog response:', response);
                                        resolve(response);
                                }
                        });
                });
        });
}

async function handleMessage(request) {
        console.log('Handling message:', request);

        switch (request.method || request.type || request.action) {
                case 'CONTENT_SCRIPT_LOADED':
                        contentScriptReady = true;
                        console.log('Content script loaded');
                        return { success: true };

                case 'bitcoin_requestAccounts':
                        return await handleRequestAccounts();

                // case 'requestAccounts':
                //         return await handleRequestAccounts();

                case 'bitcoin_signMessage':
                case 'signMessage':
                        return await handleSignMessage(request);

                case 'bitcoin_createPsbt':
                        return await handleCreatePSBT(request.params[0], request.params[1], request.params[2]);

                // case 'createPSBT':
                //         return await handleCreatePSBT(request);

                case 'bitcoin_signPsbt':
                case 'signPsbt':
                        return await handleSignPsbt(request);

                // case 'signPsbt':
                //         return await handleSignPSBT(request);

                case 'bitcoin_broadcastTransaction':
                        return await handleBroadcastPSBT(request);

                // case 'broadcastPSBT':
                //         return await handleBroadcastPSBT(request);

                case 'createWallet':
                        return await createWallet();

                case 'encryptWallet':
                        return await handleEncryptWallet(request);

                case 'decryptWallets':
                        return await handleDecryptWallets(request);

                case 'bitcoin_getBalance':
                case 'getBalance':
                        try {
                                const address = request.params ? request.params[0] : request.address;
                                const balanceData = await getBalance(address);
                                return { success: true, balance: balanceData.balance };
                        } catch (error) {
                                return { success: false, error: error.message };
                        }

                case 'derivePublicKey':
                        return await handleDerivePublicKey(request.params[0]);

                case 'getPaymentUtxos':
                        return await handleGetPaymentUtxos(request.params[0]);

                case 'getWalletProvider':
                        return await handleGetWalletProvider();

                case 'generateTransferPsbt':
                        return await handleGenerateTransferPsbt(request.params);

                case 'setSession':
                        setSession(request.wallets, request.currentWallet, request.password);
                        return { success: true };

                case 'getSession':
                        return await handleGetSession();

                case 'clearSession':
                        clearSession();
                        return { success: true };

                case 'signMessage':
                        return await handleSignMessage(request);

                case 'signPsbt':
                        return await handleSignPsbt(request);

                // case "FROM_PAGE_CHECK_CONNECTION":
                //         return { type: "FROM_EXTENSION", action: "CONNECTION_STATUS", connected: true };

                // case "FROM_PAGE_GET_CURRENT_ADDRESS":
                //         return await getCurrentAddress();

                // case "FROM_PAGE_SIGN_MESSAGE":
                //         return await handleSignMessage(request);

                // case 'createPSBT':
                // case "FROM_PAGE_CREATE_PSBT":
                //         return await handleCreatePSBT(request);

                // case "FROM_PAGE_SIGN_PSBT":
                //         return await handleSignPSBT(request);

                // case "FROM_PAGE_BROADCAST_PSBT":
                //         return await handleBroadcastPSBT(request);

                // case "FROM_PAGE_REJECT_PSBT":
                case "bitcoin_rejectPsbt":
                        return await handleRejectPSBT(request);

                // case "FROM_PAGE_RESET_UTXO_STATE":
                //         resetUtxoState();
                //         await chrome.storage.local.remove('tempReservedUtxos');
                //         return { success: true, message: 'UTXO state reset' };

                default:
                        throw new Error(`Unknown request type: ${request.method || request.type || request.action}`);

        }
}

async function handleRequestAccounts() {
        try {
                const currentWallet = await getCurrentWallet();
                if (currentWallet) {
                        return { success: true, accounts: [currentWallet.address] };
                } else {
                        throw new Error('No wallet available');
                }
        } catch (error) {
                console.error('Error in handleRequestAccounts:', error);
                return { success: false, error: error.message };
        }
}

async function getWalletProvider() {
        // This should return the name of the current wallet provider
        // You might store this information when the wallet is connected
        return 'test'; // or whatever the current provider is
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        handleMessage(request)
                .then(response => {
                        console.log('Sending response:', response);
                        sendResponse(response);
                })
                .catch(error => {
                        console.error('Error handling message:', error);
                        sendResponse({ success: false, error: error.message });
                });
        return true;  // Indicates that the response is sent asynchronously
});

async function handleDerivePublicKey(address) {
        const currentWallet = await getCurrentWallet();
        if (!currentWallet || !currentWallet.wif) {
                throw new Error('No wallet available or WIF not found');
        }
        return derivePublicKey(currentWallet.wif);
}

async function handleGetPaymentUtxos(address) {
        return await getPaymentUtxos(address);
}

async function handleGetWalletProvider() {
        // Implement this based on how you're storing the wallet provider information
        return 'leather'; // or whatever the current provider is
}

async function handleGenerateTransferPsbt(params) {
        console.log('Handling generateTransferPsbt with params:', params);
        try {
                const { amount, toAddress, type, user, isCustodial } = params[0];
                console.log('Parsed params:', { amount, toAddress, type, user, isCustodial });

                if (!amount || !toAddress || !type || !user) {
                        throw new Error('Missing required parameters for PSBT generation');
                }

                console.log('User object:', user);
                console.log('Payment UTXOs:', user.paymentUtxos);

                if (!Array.isArray(user.paymentUtxos) || user.paymentUtxos.length === 0) {
                        throw new Error('No UTXOs available for payment');
                }

                const feeRate = await getMinFee();
                console.log('Fee rate:', feeRate);

                // Ensure the public key is in the correct format
                let publicKey = user.paymentPublicKey;
                console.log('Original Public Key:', publicKey);

                // Find the start of the actual public key (looking for '02' or '03' prefix)
                const keyStart = publicKey.search(/0[23]/);
                if (keyStart === -1) {
                        throw new Error('Could not find valid public key prefix');
                }

                // Extract the actual public key (66 characters starting from the found prefix)
                publicKey = publicKey.substr(keyStart, 66);

                // Remove any non-hex characters
                publicKey = publicKey.replace(/[^0-9a-fA-F]/g, '');

                console.log('Processed Public Key:', publicKey);
                console.log('Processed Public Key Length:', publicKey.length);

                // Check if the public key starts with '02' or '03' (compressed public key prefix)
                if (!publicKey.startsWith('02') && !publicKey.startsWith('03')) {
                        throw new Error(`Invalid public key prefix: ${publicKey.substring(0, 2)}`);
                }

                // Ensure the public key is 33 bytes (66 characters in hex)
                if (publicKey.length !== 66) {
                        throw new Error(`Invalid public key length: ${publicKey.length}. Expected 66 characters.`);
                }

                console.log('Final Public Key:', publicKey);
                console.log('Final Public Key Length:', publicKey.length);

                console.log('Calling generateTransferPsbt...');
                const result = await generateTransferPsbt(amount, toAddress, feeRate, type, {
                        ...user,
                        paymentPublicKey: publicKey
                }, isCustodial);
                console.log('PSBT generation result:', result);
                return { success: true, ...result };
        } catch (error) {
                console.error('Error in handleGenerateTransferPsbt:', error);
                return { success: false, error: error.message };
        }
}


// Keep the background script alive
chrome.runtime.onInstalled.addListener(() => {
        chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'keepAlive') {
                extendSession();
        }
});