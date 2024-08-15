// src/background.js
import { generateMnemonic, walletFromSeedPhrase } from './wallet';
import { signMessage, verifyMessage } from './MessageSigning';
import { createPsbt, createDummyPsbt, signPsbt, broadcastTransaction, getPaymentUtxos } from './PsbtService';
import CryptoJS from 'crypto-js';
import { derivePublicKey } from './utils/cryptoUtils';
import { Buffer } from 'buffer';
import crypto from 'crypto-browserify';
import * as bitcoin from 'bitcoinjs-lib';

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
async function getBalance(address) {
        console.log('getBalance called for address:', address);
        try {
                const response = await fetch(`https://api.blockcypher.com/v1/btc/test3/addrs/${address}/balance`);
                const data = await response.json();
                console.log('Balance data received:', data);
                return data.balance / 100000000; // Convert satoshis to BTC
        } catch (error) {
                console.error('Error fetching balance:', error);
                return null;
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

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('Received message:', request);

        handleMessage(request)
                .then(sendResponse)
                .catch(error => {
                        console.error('Error handling message:', error);
                        sendResponse({ type: "FROM_EXTENSION", action: "ERROR", message: error.message || 'An error occurred' });
                });

        return true; // Indicates that the response is sent asynchronously
});

async function handleMessage(request) {
        console.log('Handling message:', request); // Add this line for debugging

        switch (request.type || request.action) {
                case 'createWallet':
                        return await createWallet();
                case 'encryptWallet':
                        return await handleEncryptWallet(request);
                case 'decryptWallets':
                        return await handleDecryptWallets(request);
                case 'getBalance':
                        return await getBalance(request.address);
                case 'setSession':
                        setSession(request.wallets, request.currentWallet, request.password);
                        return { success: true };
                case 'getSession':
                        return await handleGetSession();
                case 'clearSession':
                        clearSession();
                        return { success: true };
                case "FROM_PAGE_CHECK_CONNECTION":
                        return { type: "FROM_EXTENSION", action: "CONNECTION_STATUS", connected: true };
                case "FROM_PAGE_SIGN_MESSAGE":
                        return await handleSignMessage(request);
                case "FROM_PAGE_SIGN_PSBT":
                        return await handleSignPSBT(request);
                case "FROM_PAGE_BROADCAST_PSBT":
                        return await handleBroadcastPSBT(request);
                default:
                        console.error('Unknown request type:', request.type || request.action);
                        throw new Error("Unknown request type");
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
        const { message } = request;
        return new Promise((resolve, reject) => {
                chrome.storage.local.get(['sessionCurrentWallet'], (result) => {
                        if (result.sessionCurrentWallet && result.sessionCurrentWallet.wif) {
                                try {
                                        const signature = signMessage(message, result.sessionCurrentWallet.wif);
                                        resolve({ type: "FROM_EXTENSION", action: "SIGNATURE_RESULT", signature: signature });
                                } catch (error) {
                                        reject(error);
                                }
                        } else {
                                reject(new Error("No wallet available"));
                        }
                });
        });
}

async function handleSignPSBT(request) {
        const { psbtHex } = request;
        return new Promise((resolve, reject) => {
                chrome.storage.local.get(['sessionCurrentWallet'], (result) => {
                        if (result.sessionCurrentWallet && result.sessionCurrentWallet.wif) {
                                try {
                                        const signedPsbtHex = signPsbt(psbtHex, result.sessionCurrentWallet.wif);
                                        resolve({ type: "FROM_EXTENSION", action: "PSBT_SIGNED", signedPsbtHex: signedPsbtHex });
                                } catch (error) {
                                        reject(error);
                                }
                        } else {
                                reject(new Error("No wallet available"));
                        }
                });
        });
}

async function handleBroadcastPSBT(request) {
        const { psbtHex } = request;
        try {
                const result = await broadcastTransaction(psbtHex);
                if (result.success) {
                        return { type: "FROM_EXTENSION", action: "PSBT_BROADCASTED", txid: result.txid };
                } else {
                        throw new Error(result.error);
                }
        } catch (error) {
                throw new Error('Unexpected error in broadcastTransaction: ' + error.message);
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