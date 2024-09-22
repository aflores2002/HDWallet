// src/services/bitcoinService.js
import * as bitcoin from 'bitcoinjs-lib';
import ky from 'ky';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import CryptoJS from 'crypto-js';

// Initialize ECPair
const ECPair = ECPairFactory(ecc);

const TESTNET = bitcoin.networks.testnet;
const MAINNET = bitcoin.networks.bitcoin;

// Choose network (change to MAINNET when ready for production)
const NETWORK = TESTNET;

const MEMPOOL_API = NETWORK === TESTNET
        ? 'https://mempool.space/testnet/api'
        : 'https://mempool.space/api';

async function getUTXOs(address) {
        const response = await ky.get(`${MEMPOOL_API}/address/${address}/utxo`).json();
        return response;
}

async function verifyUTXOs(utxos) {
        const validUTXOs = [];
        for (const utxo of utxos) {
                try {
                        const response = await fetch(`${MEMPOOL_API}/tx/${utxo.txid}`);
                        if (response.ok) {
                                const txData = await response.json();
                                if (txData.status.confirmed) {
                                        validUTXOs.push(utxo);
                                }
                        }
                } catch (error) {
                        console.error('Error verifying UTXO:', error);
                }
        }
        return validUTXOs;
}

async function getCurrentFeeRate() {
        const response = await ky.get(`${MEMPOOL_API}/v1/fees/recommended`).json();
        return response.halfHourFee; // satoshis per byte
}

async function broadcastTransaction(txHex) {
        const response = await fetch(`${MEMPOOL_API}/tx`, {
                method: 'POST',
                body: txHex,
                headers: {
                        'Content-Type': 'text/plain',
                },
        });

        if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to broadcast transaction: ${response.status} ${response.statusText}. ${errorText}`);
        }

        return await response.text(); // This should be the transaction ID
}

export async function sendBitcoin(senderWIF, recipientAddress, amountBTC, feeRate = null) {
        try {
                console.log('sendBitcoin called with:', { recipientAddress, amountBTC, feeRate });

                if (!senderWIF) {
                        throw new Error('Sender WIF is not provided');
                }

                const keyPair = ECPair.fromWIF(senderWIF, NETWORK);
                const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK });

                const utxos = await getUTXOs(address);
                console.log('Valid UTXOs:', utxos);

                if (utxos.length === 0) throw new Error('No UTXOs available');

                const psbt = new bitcoin.Psbt({ network: NETWORK });

                let totalInput = 0;
                utxos.forEach(utxo => {
                        psbt.addInput({
                                hash: utxo.txid,
                                index: utxo.vout,
                                witnessUtxo: {
                                        script: bitcoin.address.toOutputScript(address, NETWORK),
                                        value: utxo.value,
                                }
                        });
                        totalInput += utxo.value;
                });

                console.log('Total input:', totalInput);

                const amountSatoshis = Math.floor(amountBTC * 100000000);
                console.log('Amount in satoshis:', amountSatoshis);

                psbt.addOutput({
                        address: recipientAddress,
                        value: amountSatoshis,
                });

                if (!feeRate) {
                        feeRate = await getCurrentFeeRate();
                }
                console.log('Fee rate:', feeRate);

                // Estimate transaction size and calculate fee
                const estimatedSize = utxos.length * 180 + 2 * 34 + 10; // Rough estimate
                const fee = Math.max(estimatedSize * feeRate, 1000); // Ensure minimum fee of 1000 satoshis
                console.log('Estimated fee:', fee);

                if (totalInput < amountSatoshis + fee) {
                        throw new Error(`Insufficient funds. Required: ${amountSatoshis + fee}, Available: ${totalInput}`);
                }

                // Add change output if necessary
                const change = totalInput - amountSatoshis - fee;
                if (change > 546) { // Dust threshold
                        psbt.addOutput({
                                address: address,
                                value: change,
                        });
                        console.log('Change output added:', change);
                } else {
                        console.log('No change output added. Change amount:', change);
                }

                // Sign inputs
                utxos.forEach((_, index) => {
                        psbt.signInput(index, keyPair);
                });

                psbt.finalizeAllInputs();

                const tx = psbt.extractTransaction();
                const txHex = tx.toHex();
                console.log('Transaction hex:', txHex);

                // Broadcast transaction
                try {
                        const txid = await broadcastTransaction(txHex);
                        console.log('Transaction broadcast successful. TXID:', txid);
                        return { success: true, txid: txid };
                } catch (broadcastError) {
                        console.error('Error broadcasting transaction:', broadcastError);
                        if (broadcastError.response) {
                                console.error('Response data:', await broadcastError.response.text());
                        }
                        throw broadcastError;
                }

        } catch (error) {
                console.error('Error sending Bitcoin:', error);
                return { success: false, error: error.message };
        }
}

// New function to get the current wallet
async function getCurrentWallet() {
        return new Promise((resolve) => {
                chrome.storage.local.get(['sessionCurrentWallet'], (result) => {
                        resolve(result.sessionCurrentWallet);
                });
        });
}

async function getWalletPassword() {
        return new Promise((resolve) => {
                chrome.storage.local.get(['sessionPassword'], (result) => {
                        resolve(result.sessionPassword);
                });
        });
}

// Updated sendBitcoin function to work with the chat interface
export async function sendBitcoinFromChat(toAddress, amountSatoshis, feeRate) {
        console.log('sendBitcoinFromChat called with:', { toAddress, amountSatoshis, feeRate });

        try {
                const wallet = await getCurrentWallet();
                if (!wallet) {
                        console.error('No wallet available');
                        return { success: false, error: 'No wallet available' };
                }

                console.log('Current wallet:', wallet);

                // Decrypt the WIF
                const password = await getWalletPassword(); // You need to implement this function
                if (!password) {
                        return { success: false, error: 'Wallet password not available' };
                }

                let decryptedWIF;
                try {
                        decryptedWIF = CryptoJS.AES.decrypt(wallet.encryptedWIF, password).toString(CryptoJS.enc.Utf8);
                        if (!decryptedWIF) {
                                throw new Error('Failed to decrypt WIF');
                        }
                } catch (decryptError) {
                        console.error('Error decrypting WIF:', decryptError);
                        return { success: false, error: 'Failed to decrypt wallet' };
                }

                const amountBTC = amountSatoshis / 100000000; // Convert to BTC
                console.log('Amount in BTC:', amountBTC);

                const result = await sendBitcoin(decryptedWIF, toAddress, amountBTC, feeRate);
                console.log('sendBitcoin result:', result);

                if (result.success) {
                        return { success: true, txid: result.txid };
                } else {
                        console.error('Transaction failed:', result.error);
                        return { success: false, error: result.error };
                }
        } catch (error) {
                console.error('Error in sendBitcoinFromChat:', error);
                return { success: false, error: error.message || 'Unknown error occurred' };
        }
}