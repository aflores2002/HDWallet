import { generateMnemonic, walletFromSeedPhrase } from './wallet';
// import { signBtcTransaction } from './transactions/btc';
// import { getAddressUtxoOrdinalBundles } from './api/ordinals';

// import * as bip39 from 'bip39';
// import * as hdkey from 'hdkey';
import CryptoJS from 'crypto-js';
import { Buffer } from 'buffer';
import crypto from 'crypto-browserify';

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
        // const wallet = await walletFromSeedPhrase({ mnemonic, index: 0, network: 'Testnet' });
        // console.log('Created wallet:', wallet);
        // // // Store wallet info securely
        // // chrome.storage.local.set({ wallet: wallet }, () => {
        // //      console.log('Wallet created and stored');
        // // });
        // return {
        //         mnemonic: wallet.mnemonic,
        //         wif: wallet.wif,
        //         address: wallet.address
        // };
}

// Function to login with mnemonic
// async function loginWallet(mnemonic) {
//         try {
//                 const wallet = await walletFromSeedPhrase({ mnemonic, index: 0, network: 'Testnet' });
//                 chrome.storage.local.set({ wallet: wallet }, () => {
//                         console.log('Wallet logged in and stored');
//                 });
//                 return { success: true, wallet };
//         } catch (error) {
//                 console.error('Login failed:', error);
//                 return { success: false };
//         }
// }

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
        console.log('Encrypting wallet:', JSON.stringify(wallet, null, 2));
        if (!wallet) {
                console.error('Wallet is undefined or null');
                return { success: false, error: 'Wallet is undefined or null' };
        }
        if (!wallet.mnemonic) {
                console.error('Wallet mnemonic is missing');
                return { success: false, error: 'Wallet mnemonic is missing' };
        }
        if (!wallet.wif) {
                console.error('Wallet WIF is missing');
                return { success: false, error: 'Wallet WIF is missing' };
        }
        if (!wallet.address) {
                console.error('Wallet address is missing');
                return { success: false, error: 'Wallet address is missing' };
        }
        try {
                const encryptedMnemonic = CryptoJS.AES.encrypt(wallet.mnemonic, password).toString();
                const encryptedWIF = CryptoJS.AES.encrypt(wallet.wif, password).toString();
                const encryptedWallet = {
                        encryptedMnemonic,
                        encryptedWIF,
                        address: wallet.address
                };
                console.log('Encrypted wallet:', JSON.stringify(encryptedWallet, null, 2));
                return { success: true, encryptedWallet };
        } catch (error) {
                console.error('Encryption failed:', error);
                return { success: false, error: 'Encryption failed: ' + error.message };
        }
}

function decryptWallet(encryptedWallet, password) {
        console.log('Attempting to decrypt wallet:', encryptedWallet);
        if (!encryptedWallet || !encryptedWallet.encryptedMnemonic || !encryptedWallet.encryptedWIF) {
                console.error('Invalid encrypted wallet data:', encryptedWallet);
                return { success: false, error: 'Invalid wallet data' };
        }
        try {
                const mnemonicBytes = CryptoJS.AES.decrypt(encryptedWallet.encryptedMnemonic, password);
                const mnemonic = mnemonicBytes.toString(CryptoJS.enc.Utf8);
                const wifBytes = CryptoJS.AES.decrypt(encryptedWallet.encryptedWIF, password);
                const wif = wifBytes.toString(CryptoJS.enc.Utf8);
                if (!mnemonic || !wif) {
                        console.error('Decryption resulted in empty mnemonic or WIF');
                        return { success: false, error: 'Incorrect password or corrupted data' };
                }
                console.log('Wallet decrypted successfully');
                return { success: true, wallet: { mnemonic, wif, address: encryptedWallet.address } };
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
                console.log('Encrypting wallet request:', request);
                if (!request.wallet || !request.password) {
                        console.error('Invalid wallet data or password');
                        sendResponse({ success: false, error: 'Invalid wallet data or password' });
                        return true;
                }
                const encryptionResult = encryptWallet(request.wallet, request.password);
                if (!encryptionResult.success) {
                        console.error('Encryption failed:', encryptionResult.error);
                        sendResponse({ success: false, error: encryptionResult.error });
                        return true;
                }
                chrome.storage.local.get(['wallets'], (result) => {
                        let wallets = result.wallets || [];
                        if (!Array.isArray(wallets)) {
                                wallets = [];
                        }
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
                console.log('Decrypting wallets request:', request);
                chrome.storage.local.get(['wallets'], (result) => {
                        console.log('Retrieved wallets:', result.wallets);
                        let wallets = result.wallets;
                        if (wallets && !Array.isArray(wallets)) {
                                wallets = Object.values(wallets);
                        } else if (!wallets) {
                                wallets = [];
                        }
                        if (!wallets || wallets.length === 0) {
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

                //} else if (request.action === 'loginWallet') {
                //        loginWallet(request.mnemonic).then(sendResponse);
                //        return true;
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
        }
});

//console.log('Background script running')

// Keep the background script alive
chrome.runtime.onInstalled.addListener(() => {
        chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'keepAlive') {
                extendSession();
        }
});