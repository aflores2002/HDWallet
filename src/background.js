// src/background.js
import { generateMnemonic, walletFromSeedPhrase } from './wallet';
import { signMessage, verifyMessage } from './MessageSigning';
import { createPsbt, signPsbt, broadcastTransaction, rejectPsbt, resetUtxoState } from './PsbtService.js';
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
        handleMessage(request, sender)
                .then(response => {
                        console.log('Sending response:', response);  // Debug log
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

async function handleCreatePSBT(request) {
        try {
                const currentWallet = await getCurrentWallet();
                const { recipientAddress, amountInSatoshis, feeRate } = request;
                const senderAddress = request.senderAddress || currentWallet.address;
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

async function handleSignPSBT(request) {
        try {
                // Show a confirmation dialog to the user
                const userConfirmation = await showConfirmationDialog({
                        type: 'signPSBT',
                        psbtHex: request.psbtHex
                });
                console.log('User confirmation result for PSBT signing:', userConfirmation);

                if (!userConfirmation.confirmed) {
                        console.log('User rejected PSBT signing');
                        return await handleRejectPSBT(request);
                }

                console.log('User confirmed, proceeding with PSBT signing');
                const { psbtHex } = request;
                const currentWallet = await getCurrentWallet();
                if (currentWallet && currentWallet.wif) {
                        const signedPsbtHex = signPsbt(psbtHex, currentWallet.wif);
                        console.log('PSBT signed successfully');
                        return {
                                type: "FROM_EXTENSION",
                                action: "PSBT_SIGNED",
                                success: true,
                                signedPsbtHex: signedPsbtHex
                        };
                } else {
                        throw new Error("No wallet available");
                }
        } catch (error) {
                console.error('Error signing PSBT:', error);
                return await handleRejectPSBT(request);
        }
}

async function handleRejectPSBT(request) {
        console.log('Handling PSBT rejection');
        try {
                const { psbtHex } = request;
                rejectPsbt(psbtHex);
                await chrome.storage.local.remove('tempReservedUtxos');
                console.log('PSBT rejected and UTXOs released');
                return {
                        type: "FROM_EXTENSION",
                        action: "PSBT_REJECTED",
                        success: false,
                        message: "User rejected the request or an error occurred"
                };
        } catch (error) {
                console.error('Error rejecting PSBT:', error);
                return {
                        type: "FROM_EXTENSION",
                        action: "PSBT_REJECTION_ERROR",
                        success: false,
                        message: `Error rejecting PSBT: ${error.message}`
                };
        }
}

async function handleBroadcastPSBT(request) {
        try {
                const { psbtHex } = request;
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
                // Show a confirmation dialog to the user
                const userConfirmation = await showConfirmationDialog({
                        type: 'signMessage',
                        message: request.message
                });
                console.log('User confirmation result:', userConfirmation);  // Debug log

                if (!userConfirmation.confirmed) {
                        console.log('User rejected the request');
                        return { success: false, message: "User rejected the request" };
                }

                console.log('User confirmed, proceeding with message signing');
                const { message } = request;
                const currentWallet = await getCurrentWallet();
                if (currentWallet && currentWallet.wif) {
                        const signature = signMessage(message, currentWallet.wif);
                        console.log('Message signed, signature:', signature);  // Debug log
                        return {
                                type: "FROM_EXTENSION",
                                action: "SIGNATURE_RESULT",
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
        return new Promise((resolve) => {
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                        const activeTab = tabs[0];
                        chrome.tabs.sendMessage(activeTab.id, {
                                action: "showConfirmation",
                                request: request
                        }, function (response) {
                                console.log('Confirmation dialog response:', response);
                                resolve(response);
                        });
                });
        });
}

async function handleMessage(request) {
        console.log('Handling message:', request);

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

                case "FROM_PAGE_GET_CURRENT_ADDRESS":
                        return await getCurrentAddress();

                case "FROM_PAGE_SIGN_MESSAGE":
                        return await handleSignMessage(request);

                case 'createPSBT':
                case "FROM_PAGE_CREATE_PSBT":
                        return await handleCreatePSBT(request);

                case "FROM_PAGE_SIGN_PSBT":
                        return await handleSignPSBT(request);

                case "FROM_PAGE_BROADCAST_PSBT":
                        return await handleBroadcastPSBT(request);

                case "FROM_PAGE_REJECT_PSBT":
                        return handleRejectPSBT(request);

                case "FROM_PAGE_RESET_UTXO_STATE":
                        resetUtxoState();
                        await chrome.storage.local.remove('tempReservedUtxos');
                        return { success: true, message: 'UTXO state reset' };

                default:
                        throw new Error(`Unknown request type: ${request.type || request.action}`);

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