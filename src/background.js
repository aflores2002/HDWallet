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

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'createWallet') {
                createWallet().then(sendResponse);
                return true;
        } else if (request.action === 'encryptWallet') {
                console.log('Encrypting wallet', request.wallet);
                if (!request.wallet || !request.password) {
                        console.error('Invalid wallet data or password');
                        sendResponse({ success: false, error: 'Invalid wallet data or password' });
                        return true;
                }
                const encryptionResult = encryptWallet(request.wallet, request.password);
                if (!encryptionResult.success) {
                        console.error('Encryption failed', encryptionResult.error);
                        sendResponse({ success: false, error: encryptionResult.error });
                        return true;
                }
                chrome.storage.local.get(['wallets'], (result) => {
                        let wallets = result.wallets || [];
                        wallets.push(encryptionResult.encryptedWallet);
                        console.log('Storing wallets:', wallets);
                        chrome.storage.local.set({ wallets }, () => {
                                if (chrome.runtime.lastError) {
                                        console.error('Error storing wallet:', chrome.runtime.lastError);
                                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                                } else {
                                        console.log('Wallet stored successfully');
                                        sendResponse({ success: true, encryptedWallet: encryptionResult.encryptedWallet });
                                }
                        });
                });
                return true;
        } else if (request.action === 'decryptWallets') {
                console.log('Decrypting wallets');
                chrome.storage.local.get(['wallets'], (result) => {
                        console.log('Retrieved wallets:', result.wallets);
                        if (chrome.runtime.lastError) {
                                console.error('Error retrieving wallets:', chrome.runtime.lastError);
                                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                                return;
                        }
                        const wallets = result.wallets || [];
                        if (wallets.length === 0) {
                                console.error('No wallets found');
                                sendResponse({ success: false, error: 'No wallets found' });
                                return;
                        }
                        const decryptionResults = wallets.map(w => decryptWallet(w, request.password));
                        console.log('Decryption results:', decryptionResults);
                        const decryptedWallets = decryptionResults.filter(r => r.success).map(r => r.wallet);
                        if (decryptedWallets.length === 0) {
                                console.error('Failed to decrypt any wallets');
                                const errors = decryptionResults.map(r => r.error).join('; ');
                                sendResponse({ success: false, error: 'Failed to decrypt any wallets: ' + errors });
                        } else {
                                console.log('Successfully decrypted wallets:', decryptedWallets);
                                sendResponse({ success: true, wallets: decryptedWallets });
                        }
                });
                return true;
        } else if (request.action === 'getBalance') {
                console.log('Received getBalance message for address:', request.address);
                getBalance(request.address).then(balance => {
                        console.log('Sending balance response:', balance);
                        sendResponse(balance);
                });
                return true;
        } else if (request.action === 'setSession') {
                setSession(request.wallets, request.currentWallet, request.password);
                sendResponse({ success: true });
        } else if (request.action === 'getSession') {
                chrome.storage.local.get(['sessionWallets', 'sessionCurrentWallet', 'sessionPassword'], (result) => {
                        if (result.sessionWallets && result.sessionCurrentWallet && result.sessionPassword) {
                                extendSession();
                                sendResponse({
                                        success: true,
                                        wallets: result.sessionWallets,
                                        currentWallet: result.sessionCurrentWallet,
                                        password: result.sessionPassword
                                });
                        } else {
                                sendResponse({ success: false });
                        }
                });
                return true;  // Indicates we will send a response asynchronously
        } else if (request.action === 'clearSession') {
                clearSession();
                sendResponse({ success: true });
        } else if (request.action === 'signMessage') {
                const { message, wif } = request;
                console.log('Received sign message request:', { message, wifProvided: !!wif });
                try {
                        const signature = signMessage(message, wif);
                        console.log('Message signed successfully');
                        console.log('Signature:', signature);
                        sendResponse({ success: true, signature });
                } catch (error) {
                        console.error('Error signing message:', error);
                        console.error('Error stack:', error.stack);
                        sendResponse({ success: false, error: error.message });
                }
                return true;
        } else if (request.action === 'verifyMessage') {
                const { message, address, signature } = request;
                console.log('Received verify message request:', { message, address, signatureProvided: !!signature });
                try {
                        const isValid = verifyMessage(message, address, signature);
                        console.log('Message verification result:', isValid);
                        sendResponse({ success: true, isValid });
                } catch (error) {
                        console.error('Error verifying message:', error);
                        console.error('Error stack:', error.stack);
                        sendResponse({ success: false, error: error.message });
                }
                return true;
        } else if (request.action === 'createAndSignPsbt') {
                const { paymentAddress, paymentPublicKey, wif } = request;
                console.log('Received createAndSignPsbt request:', {
                        paymentAddress,
                        paymentPublicKeyProvided: !!paymentPublicKey,
                        wifProvided: !!wif
                });
                try {
                        if (!paymentPublicKey) {
                                throw new Error('Payment public key is missing');
                        }
                        if (!wif) {
                                throw new Error('WIF is missing');
                        }
                        getPaymentUtxos(paymentAddress).then(utxos => {
                                let psbt;
                                let isDummy = false;
                                try {
                                        if (utxos.length === 0) {
                                                console.log('No UTXOs available. Creating dummy PSBT for testing.');
                                                psbt = createDummyPsbt(paymentAddress, paymentPublicKey);
                                                isDummy = true;
                                        } else {
                                                console.log('UTXOs found:', utxos);
                                                psbt = createPsbt(utxos, request.outputs, paymentAddress, paymentPublicKey);
                                        }
                                        console.log('PSBT created successfully');
                                        const psbtHex = psbt.toHex();
                                        console.log('Attempting to sign PSBT');
                                        const signedPsbtHex = signPsbt(psbtHex, wif);
                                        console.log('PSBT signed successfully');
                                        sendResponse({ success: true, signedPsbtHex, isDummy });
                                } catch (error) {
                                        console.error('Error in PSBT creation or signing:', error);
                                        sendResponse({ success: false, error: error.message });
                                }
                        }).catch(error => {
                                console.error('Error fetching UTXOs:', error);
                                sendResponse({ success: false, error: error.message });
                        });
                } catch (error) {
                        console.error('Error in createAndSignPsbt:', error);
                        sendResponse({ success: false, error: error.message });
                }
                return true;
        } else if (request.action === 'broadcastTransaction') {
                console.log('Received broadcastTransaction request');
                const { signedPsbtHex } = request;
                broadcastTransaction(signedPsbtHex).then(result => {
                        if (result.success) {
                                console.log('Transaction broadcasted successfully:', result.txid);
                                sendResponse({ success: true, txid: result.txid });
                        } else {
                                console.error('Error broadcasting transaction:', result.error);
                                sendResponse({ success: false, error: result.error });
                        }
                }).catch(error => {
                        console.error('Unexpected error in broadcastTransaction:', error);
                        sendResponse({ success: false, error: 'Unexpected error occurred' });
                });
                return true;
        }
});

// Keep the background script alive
chrome.runtime.onInstalled.addListener(() => {
        chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'keepAlive') {
                extendSession();
        }
});