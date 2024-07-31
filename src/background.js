import { generateMnemonic, walletFromSeedPhrase, validateBtcAddress, validateStxAddress } from './wallet';
import { signBtcTransaction } from './transactions/btc';
import { getAddressUtxoOrdinalBundles } from './api/ordinals';

import * as bip39 from 'bip39';
import * as hdkey from 'hdkey';
import CryptoJS from 'crypto-js';

// Function to create a new wallet
async function createWallet() {
        const mnemonic = generateMnemonic();
        const wallet = await walletFromSeedPhrase({ mnemonic, index: 0, network: 'Testnet' });
        // Store wallet info securely
        chrome.storage.local.set({ wallet: wallet }, () => {
                console.log('Wallet created and stored');
        });
        return wallet;
}

// Function to login with mnemonic
async function loginWallet(mnemonic) {
        try {
                const wallet = await walletFromSeedPhrase({ mnemonic, index: 0, network: 'Testnet' });
                chrome.storage.local.set({ wallet: wallet }, () => {
                        console.log('Wallet logged in and stored');
                });
                return { success: true, wallet };
        } catch (error) {
                console.error('Login failed:', error);
                return { success: false };
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


// Function to send Bitcoin
async function sendBitcoin(toAddress, amount, fee) {
        // Implement transaction creation and signing using signBtcTransaction
        // Broadcast the transaction
        console.log('Sending Bitcoin to:', toAddress, 'Amount:', amount, 'Fee:', fee);
}


function encryptWallet(wallet, password) {
        if (!wallet || !wallet.mnemonic) {
                console.error('Invalid wallet data');
                return null;
        }
        try {
                const encryptedMnemonic = CryptoJS.AES.encrypt(wallet.mnemonic, password).toString();
                return {
                        encryptedMnemonic,
                        address: wallet.address
                };
        } catch (error) {
                console.error('Encryption failed:', error);
                return null;
        }
}

function decryptWallet(encryptedWallet, password) {
        console.log('Attempting to decrypt wallet:', encryptedWallet);
        if (!encryptedWallet || !encryptedWallet.encryptedMnemonic) {
                console.error('Invalid encrypted wallet data');
                return { success: false, error: 'Invalid wallet data' };
        }
        try {
                const bytes = CryptoJS.AES.decrypt(encryptedWallet.encryptedMnemonic, password);
                const mnemonic = bytes.toString(CryptoJS.enc.Utf8);
                if (!mnemonic) {
                        console.error('Decryption resulted in empty mnemonic');
                        return { success: false, error: 'Incorrect password or corrupted data' };
                }
                console.log('Wallet decrypted successfully');
                return { success: true, wallet: { mnemonic, address: encryptedWallet.address } };
        } catch (error) {
                console.error('Decryption failed:', error);
                return { success: false, error: 'Decryption failed: ' + error.message };
        }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'createWallet') {
                createWallet().then(sendResponse);
                return true;
        } else if (request.action === 'encryptWallet') {
                console.log('Encrypting wallet');
                if (!request.wallet || !request.password) {
                        console.error('Invalid wallet data or password');
                        sendResponse({ success: false, error: 'Invalid wallet data or password' });
                        return true;
                }
                const encryptedWallet = encryptWallet(request.wallet, request.password);
                if (!encryptedWallet) {
                        console.error('Encryption failed');
                        sendResponse({ success: false, error: 'Encryption failed' });
                        return true;
                }
                chrome.storage.local.get(['wallets'], (result) => {
                        let wallets = result.wallets || {};
                        if (!wallets[request.password]) {
                                wallets[request.password] = [];
                        }
                        wallets[request.password].push(encryptedWallet);
                        console.log('Storing wallets:', wallets);
                        chrome.storage.local.set({ wallets }, () => {
                                if (chrome.runtime.lastError) {
                                        console.error('Error storing wallet:', chrome.runtime.lastError);
                                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                                } else {
                                        console.log('Wallet stored successfully');
                                        sendResponse({ success: true, encryptedWallet });
                                }
                        });
                });
                return true;    // change

        } else if (request.action === 'decryptWallets') {
                console.log('Decrypting wallets');
                chrome.storage.local.get(['wallets'], (result) => {
                        console.log('Retrieved wallets:', result.wallets);
                        if (chrome.runtime.lastError) {
                                console.error('Error retrieving wallets:', chrome.runtime.lastError);
                                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                                return;
                        }
                        const wallets = result.wallets && result.wallets[request.password];
                        if (!wallets || wallets.length === 0) {
                                console.error('No wallets found for password:', request.password);
                                sendResponse({ success: false, error: 'No wallets found for this password' });
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
        } else if (request.action === 'sendBitcoin') {
                sendBitcoin(request.toAddress, request.amount, request.fee).then(sendResponse);
                return true;
        }
});

console.log('Background script running');