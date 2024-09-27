// src/services/bitcoinService.js
import * as bitcoin from 'bitcoinjs-lib';
import ky from 'ky';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import CryptoJS from 'crypto-js';

import { getPaymentUtxos, signPsbt } from '../PsbtService';
import { addPaymentInputs, getNetworkFee } from '../utils/fee';
import { toXOnly } from '../utils/transaction';

// Initialize the elliptic curve library
bitcoin.initEccLib(ecc);

// Initialize ECPair
const ECPair = ECPairFactory(ecc);

// Choose network (change to MAINNET when ready for production)
const NETWORK = bitcoin.networks.testnet;
const MEMPOOL_API = 'https://mempool.space/testnet/api';

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

export function validateAddress(address) {
        try {
                bitcoin.address.toOutputScript(address, bitcoin.networks.testnet);
                console.log('Address validated successfully:', address);
                return true;
        } catch (error) {
                console.error('Address validation error:', error);
                return false;
        }
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

// Helper function to get the current wallet
async function getCurrentWallet() {
        return new Promise((resolve) => {
                chrome.storage.local.get(['sessionCurrentWallet'], (result) => {
                        resolve(result.sessionCurrentWallet);
                });
        });
}

// Helper function to get the wallet password
async function getWalletPassword() {
        return new Promise((resolve) => {
                chrome.storage.local.get(['sessionPassword'], (result) => {
                        resolve(result.sessionPassword);
                });
        });
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

export async function sendBitcoinFromChat(toAddress, amountSatoshis, feeRate, psbtHex) {
        console.log('sendBitcoinFromChat called with:', { toAddress, amountSatoshis, feeRate, psbtHex });

        try {
                // Validate addresses
                if (!validateAddress(toAddress)) {
                        throw new Error(`Invalid recipient address: ${toAddress}`);
                }

                const wallet = await getCurrentWallet();
                console.log('Current wallet:', wallet);

                if (!validateAddress(wallet.address)) {
                        throw new Error(`Invalid sender address: ${wallet.address}`);
                }

                let wif;
                if (wallet.wif) {
                        // The WIF is not encrypted
                        wif = wallet.wif;
                        console.log('Using unencrypted WIF');
                } else if (wallet.encryptedWIF) {
                        // The WIF is encrypted
                        const password = await getWalletPassword();
                        if (!password) {
                                throw new Error('Wallet password not available');
                        }
                        wif = CryptoJS.AES.decrypt(wallet.encryptedWIF, password).toString(CryptoJS.enc.Utf8);
                        if (!wif) {
                                throw new Error('Failed to decrypt WIF');
                        }
                        console.log('WIF decrypted successfully');
                } else {
                        throw new Error('No WIF available in the wallet');
                }

                const keyPair = ECPair.fromWIF(wif, NETWORK);
                const publicKey = keyPair.publicKey.toString('hex');

                // Verify that the public key matches
                if (publicKey !== wallet.publicKey) {
                        console.error('Public key mismatch');
                        console.error('Derived:', publicKey);
                        console.error('Stored:', wallet.publicKey);
                        throw new Error('WIF does not correspond to the wallet public key');
                }

                // Verify the keyPair corresponds to the wallet address
                const derivedAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK }).address;
                if (derivedAddress !== wallet.address) {
                        throw new Error('WIF does not correspond to the wallet address');
                }

                // Prepare PSBT inputs
                const paymentAddress = wallet.address;
                const paymentPublicKey = publicKey;
                const paymentUtxos = await getPaymentUtxos(paymentAddress);
                const paymentScript = bitcoin.address.toOutputScript(paymentAddress, NETWORK);
                const paymentTapInternalKey = toXOnly(Buffer.from(paymentPublicKey, 'hex'));

                // Create new PSBT
                const psbt = new bitcoin.Psbt({ network: NETWORK });

                // Add recipient output
                psbt.addOutput({
                        address: toAddress,
                        value: amountSatoshis,
                });

                // Add inputs and calculate fee
                const paymentResult = addPaymentInputs(
                        psbt,
                        feeRate,
                        paymentUtxos,
                        null, // redeemScript (not needed for P2WPKH)
                        paymentAddress,
                        paymentScript,
                        paymentTapInternalKey,
                        null, // estimateKeyPair (not needed for this use case)
                        null, // tweakedEstimateSigner (not needed for this use case)
                        'hdwallet', // walletProvider
                        null, // estimatorRunestone (not needed for this use case)
                        NETWORK
                );

                if (paymentResult.error) {
                        throw new Error(paymentResult.error);
                }

                // Calculate network fee
                const networkFee = getNetworkFee(psbt);

                console.log('PSBT created:', psbt.toBase64());
                console.log('Network fee:', networkFee);

                // Sign all inputs
                psbt.data.inputs.forEach((input, index) => {
                        try {
                                if (input.witnessUtxo) {
                                        // This is likely a P2WPKH input
                                        psbt.signInput(index, keyPair);
                                } else if (input.nonWitnessUtxo) {
                                        // This is likely a P2PKH input
                                        psbt.signInput(index, keyPair);
                                } else {
                                        console.error(`Unknown input type for input ${index}`);
                                }
                                console.log(`Input ${index} signed successfully`);
                        } catch (error) {
                                console.error(`Error signing input ${index}:`, error);
                        }
                });

                // Verify all inputs are signed
                const signedInputs = psbt.data.inputs.filter(input =>
                        (input.partialSig && input.partialSig.length > 0) ||
                        (input.finalScriptSig) ||
                        (input.finalScriptWitness)
                );
                if (signedInputs.length !== psbt.data.inputs.length) {
                        throw new Error(`Not all inputs were signed. Signed: ${signedInputs.length}, Total: ${psbt.data.inputs.length}`);
                }

                // Finalize the PSBT
                psbt.finalizeAllInputs();

                // Extract transaction
                const tx = psbt.extractTransaction();
                console.log('Transaction extracted:', tx);

                const txHex = tx.toHex();
                console.log('Transaction hex:', txHex);

                // Broadcast transaction
                const result = await broadcastTransaction(txHex);
                console.log('broadcastTransaction result:', result);

                if (result) {
                        return { success: true, txid: result };
                } else {
                        console.error('Transaction failed:', result);
                        return { success: false, error: 'Failed to broadcast transaction' };
                }
        } catch (error) {
                console.error('Error in sendBitcoinFromChat:', error);
                return { success: false, error: error.message || 'Unknown error occurred' };
        }
}