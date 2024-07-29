import { generateMnemonic, walletFromSeedPhrase, validateBtcAddress, validateStxAddress } from './wallet';
import { signBtcTransaction } from './transactions/btc';
import { getAddressUtxoOrdinalBundles } from './api/ordinals';

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

// -----------------
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
//----------

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

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'createWallet') {
                createWallet().then(sendResponse);
                return true;
        } else if (request.action === 'loginWallet') {
                loginWallet(request.mnemonic).then(sendResponse);
                return true;
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