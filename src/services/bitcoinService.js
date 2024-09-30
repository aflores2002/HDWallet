// src/services/bitcoinService.js
import * as bitcoin from 'bitcoinjs-lib';
import ky from 'ky';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import CryptoJS from 'crypto-js';

import { getPaymentUtxos, signPsbt } from '../PsbtService';
import { addPaymentInputs, getNetworkFee } from '../utils/fee';
import { toXOnly, getVirtualSize } from '../utils/transaction';

import { getMinFee } from '../utils/fee';
import BigNumber from 'bignumber.js';
import { validateFee } from '../utils/feeValidation';

// Initialize the elliptic curve library
bitcoin.initEccLib(ecc);

// Initialize ECPair
const ECPair = ECPairFactory(ecc);

// Choose network (change to MAINNET when ready for production)
const NETWORK = bitcoin.networks.testnet;
const MEMPOOL_API = 'https://mempool.space/testnet/api';

export async function getFeeRates() {
        try {
                const response = await ky.get(`${MEMPOOL_API}/v1/fees/recommended`).json();
                return {
                        fastestFee: response.fastestFee,
                        halfHourFee: response.halfHourFee,
                        hourFee: response.hourFee,
                        economyFee: response.economyFee,
                        minimumFee: response.minimumFee
                };
        } catch (error) {
                console.error('Error fetching fee rates:', error);
                return {
                        fastestFee: 20,
                        halfHourFee: 10,
                        hourFee: 5,
                        economyFee: 3,
                        minimumFee: 1
                };
        }
}

export function validateFeeRate(feeRate) {
        let fr;
        try {
                fr = new BigNumber(feeRate);
        } catch (e) {
                return "Invalid fee rate.";
        }
        if (!fr.isFinite() || fr.isLessThan(1)) {
                return "Fee rate must be at least 1 sat/vB.";
        }
        if (fr.isGreaterThan(1000)) {
                return "Fee rate is unusually high. Please double-check.";
        }
        return '';
}

export function validateAddress(address) {
        try {
                bitcoin.address.toOutputScript(address, NETWORK);
                console.log('Address validated successfully:', address);
                return true;
        } catch (error) {
                console.error('Address validation error:', error);
                return false;
        }
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

export async function sendBitcoinFromChat(toAddress, amountSatoshis, feeRate, psbtHex) {
        console.log('sendBitcoinFromChat called with:', { toAddress, amountSatoshis, feeRate, psbtHex });

        try {
                if (!validateAddress(toAddress)) {
                        throw new Error(`Invalid recipient address: ${toAddress}`);
                }

                const wallet = await getCurrentWallet();
                console.log('Current wallet:', wallet);

                if (!validateAddress(wallet.address)) {
                        throw new Error(`Invalid sender address: ${wallet.address}`);
                }

                if (!feeRate) {
                        const feeRates = await getFeeRates();
                        feeRate = feeRates.minimumFee;
                }
                console.log(`Using fee rate:`, feeRate);

                const feeRateValidation = validateFeeRate(feeRate);
                if (feeRateValidation) {
                        throw new Error(feeRateValidation);
                }

                let wif;
                if (wallet.wif) {
                        wif = wallet.wif;
                        console.log('Using unencrypted WIF');
                } else if (wallet.encryptedWIF) {
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

                if (publicKey !== wallet.publicKey) {
                        throw new Error('WIF does not correspond to the wallet public key');
                }

                const derivedAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK }).address;
                if (derivedAddress !== wallet.address) {
                        throw new Error('WIF does not correspond to the wallet address');
                }

                const paymentAddress = wallet.address;
                const paymentPublicKey = publicKey;
                const paymentUtxos = await getPaymentUtxos(paymentAddress);
                const paymentScript = bitcoin.address.toOutputScript(paymentAddress, NETWORK);
                const paymentTapInternalKey = toXOnly(Buffer.from(paymentPublicKey, 'hex'));

                const psbt = new bitcoin.Psbt({ network: NETWORK });
                console.log('Initial PSBT:', psbt.toBase64());

                psbt.addOutput({
                        address: toAddress,
                        value: amountSatoshis,
                });

                // Get current fee rates
                const currentFeeRates = await getFeeRates();
                const effectiveFeeRate = Math.max(feeRate, currentFeeRates.minimumFee, 1);
                console.log(`Using effective fee rate: ${effectiveFeeRate}`);

                const paymentResult = addPaymentInputs(
                        psbt,
                        effectiveFeeRate,
                        paymentUtxos,
                        null,
                        paymentAddress,
                        paymentScript,
                        paymentTapInternalKey,
                        null,
                        null,
                        'hdwallet',
                        null,
                        NETWORK
                );

                if (paymentResult.error) {
                        throw new Error(paymentResult.error);
                }

                console.log('PSBT after adding inputs:', psbt.toBase64());

                const estimatedVsize = getVirtualSize(psbt);
                let estimatedFee = new BigNumber(estimatedVsize).multipliedBy(effectiveFeeRate);
                console.log('Initial estimated fee:', estimatedFee.toNumber());

                // Add a 20% buffer to the fee
                estimatedFee = estimatedFee.multipliedBy(1.2).integerValue(BigNumber.ROUND_CEIL);
                console.log('Estimated fee with buffer:', estimatedFee.toNumber());

                // Ensure the fee meets the minimum requirement
                const minRequiredFee = new BigNumber(currentFeeRates.minimumFee).multipliedBy(estimatedVsize);
                let finalFee = BigNumber.max(estimatedFee, minRequiredFee);
                console.log('Initial final fee:', finalFee.toNumber());

                // Update the PSBT with the final fee
                const changeOutput = psbt.txOutputs.find(output => output.address === paymentAddress);
                if (changeOutput) {
                        const newChangeValue = changeOutput.value - finalFee.minus(estimatedFee).toNumber();
                        if (newChangeValue >= 546) { // Dust threshold
                                changeOutput.value = newChangeValue;
                        } else {
                                // If change is less than dust threshold, add it to the fee
                                psbt.txOutputs = psbt.txOutputs.filter(output => output !== changeOutput);
                                finalFee = finalFee.plus(changeOutput.value);
                        }
                } else {
                        // If no change output, reduce the payment amount
                        const paymentOutput = psbt.txOutputs.find(output => output.address === toAddress);
                        if (paymentOutput) {
                                paymentOutput.value -= finalFee.minus(estimatedFee).toNumber();
                        } else {
                                throw new Error('Unable to adjust fee: no suitable output found');
                        }
                }

                console.log('PSBT after fee adjustment:', psbt.toBase64());

                // Recalculate actual fee after adjustments
                const totalInput = new BigNumber(psbt.inputsValue);
                const totalOutput = new BigNumber(psbt.txOutputs.reduce((sum, output) => sum + output.value, 0));
                finalFee = totalInput.minus(totalOutput);
                console.log('Actual final fee after adjustments:', finalFee.toNumber());

                const feeValidationError = validateFee(finalFee, totalInput);
                if (feeValidationError) {
                        throw new Error(feeValidationError);
                }

                if (totalInput.isLessThan(new BigNumber(amountSatoshis).plus(finalFee))) {
                        throw new Error(`Insufficient funds. Required: ${new BigNumber(amountSatoshis).plus(finalFee)}, Available: ${totalInput}`);
                }

                // Signing inputs
                psbt.data.inputs.forEach((input, index) => {
                        try {
                                psbt.signInput(index, keyPair);
                                console.log(`Input ${index} signed successfully`);
                        } catch (error) {
                                console.error(`Error signing input ${index}:`, error);
                                throw error;
                        }
                });

                console.log('PSBT after signing all inputs:', psbt.toBase64());

                const signedInputs = psbt.data.inputs.filter(input =>
                        (input.partialSig && input.partialSig.length > 0) ||
                        (input.finalScriptSig) ||
                        (input.finalScriptWitness)
                );
                if (signedInputs.length !== psbt.data.inputs.length) {
                        throw new Error(`Not all inputs were signed. Signed: ${signedInputs.length}, Total: ${psbt.data.inputs.length}`);
                }

                console.log('All signatures validated successfully');

                try {
                        psbt.finalizeAllInputs();
                        console.log('PSBT finalized successfully');
                } catch (error) {
                        console.error('Error finalizing PSBT:', error);
                        throw error;
                }

                let tx = psbt.extractTransaction();
                console.log('Transaction extracted successfully');

                // Final validation and adjustment
                const finalVsize = tx.virtualSize();
                const finalFeeRate = finalFee.dividedBy(finalVsize);
                console.log('Final actual fee:', finalFee.toNumber());
                console.log('Final fee rate:', finalFeeRate.toNumber().toFixed(2), 'sat/vB');

                // If the fee rate is still below the minimum, adjust it one last time
                if (finalFee.isLessThan(minRequiredFee)) {
                        const additionalFee = minRequiredFee.minus(finalFee).plus(100); // Add 100 satoshis as buffer
                        console.log('Additional fee needed:', additionalFee.toNumber());

                        // Adjust the outputs again
                        if (changeOutput) {
                                changeOutput.value -= additionalFee.toNumber();
                                if (changeOutput.value < 546) {
                                        psbt.txOutputs = psbt.txOutputs.filter(output => output !== changeOutput);
                                        finalFee = finalFee.plus(changeOutput.value);
                                }
                        } else {
                                const paymentOutput = psbt.txOutputs.find(output => output.address === toAddress);
                                paymentOutput.value -= additionalFee.toNumber();
                        }

                        // Re-sign and finalize
                        psbt.clearFinalizedInput();
                        psbt.data.inputs.forEach((input, index) => {
                                psbt.signInput(index, keyPair);
                        });
                        psbt.finalizeAllInputs();

                        tx = psbt.extractTransaction();
                        finalFee = new BigNumber(psbt.inputsValue).minus(psbt.outputsValue);
                        finalFeeRate = finalFee.dividedBy(tx.virtualSize());
                        console.log('New final fee:', finalFee.toNumber());
                        console.log('New final fee rate:', finalFeeRate.toNumber().toFixed(2), 'sat/vB');
                }

                if (finalFeeRate.isLessThan(currentFeeRates.minimumFee)) {
                        throw new Error(`Final fee rate (${finalFeeRate.toNumber().toFixed(2)} sat/vB) is still below the minimum (${currentFeeRates.minimumFee} sat/vB)`);
                }

                console.log('Extracted transaction:', tx);
                console.log('Final fee rate:', finalFeeRate.toNumber().toFixed(2), 'sat/vB');

                const txHex = tx.toHex();
                console.log('Transaction hex:', txHex);

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



export async function sendBitcoin(recipientAddress, amountSatoshis, feeRate = null) {
        console.log('sendBitcoin called with:', { recipientAddress, amountSatoshis, feeRate });

        try {
                if (!validateAddress(recipientAddress)) {
                        throw new Error(`Invalid recipient address: ${recipientAddress}`);
                }

                const wallet = await getCurrentWallet();
                console.log('Current wallet:', wallet);

                if (!validateAddress(wallet.address)) {
                        throw new Error(`Invalid sender address: ${wallet.address}`);
                }

                const currentFeeRates = await getFeeRates();
                console.log('Current fee rates:', currentFeeRates);

                if (!feeRate) {
                        // Choose fee rate based on transaction amount
                        if (amountSatoshis < 10000) { // For small transactions (less than 10,000 satoshis)
                                feeRate = currentFeeRates.economyFee;
                        } else if (amountSatoshis < 50000) { // For medium transactions
                                feeRate = currentFeeRates.hourFee;
                        } else { // For large transactions
                                feeRate = currentFeeRates.halfHourFee;
                        }
                }

                // Ensure the fee rate is not lower than the minimum
                feeRate = Math.max(feeRate, currentFeeRates.minimumFee);
                console.log(`Using fee rate:`, feeRate);

                const feeRateValidation = validateFeeRate(feeRate);
                if (feeRateValidation) {
                        throw new Error(feeRateValidation);
                }

                let wif = await getWIF(wallet);

                const keyPair = ECPair.fromWIF(wif, NETWORK);
                const publicKey = keyPair.publicKey.toString('hex');

                if (publicKey !== wallet.publicKey) {
                        throw new Error('WIF does not correspond to the wallet public key');
                }

                const derivedAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK }).address;
                if (derivedAddress !== wallet.address) {
                        throw new Error('WIF does not correspond to the wallet address');
                }

                const paymentAddress = wallet.address;
                const paymentPublicKey = publicKey;
                const paymentUtxos = await getPaymentUtxos(paymentAddress);
                const paymentScript = bitcoin.address.toOutputScript(paymentAddress, NETWORK);
                const paymentTapInternalKey = toXOnly(Buffer.from(paymentPublicKey, 'hex'));

                const psbt = new bitcoin.Psbt({ network: NETWORK });
                console.log('Initial PSBT:', psbt.toBase64());

                psbt.addOutput({
                        address: recipientAddress,
                        value: amountSatoshis,
                });

                const paymentResult = addPaymentInputs(
                        psbt,
                        feeRate,
                        paymentUtxos,
                        null,
                        paymentAddress,
                        paymentScript,
                        paymentTapInternalKey,
                        null,
                        null,
                        'hdwallet',
                        null,
                        NETWORK
                );

                if (paymentResult.error) {
                        throw new Error(paymentResult.error);
                }

                console.log('PSBT after adding inputs:', psbt.toBase64());

                const estimatedVsize = getVirtualSize(psbt);
                let estimatedFee = new BigNumber(estimatedVsize).multipliedBy(feeRate);
                console.log('Initial estimated fee:', estimatedFee.toNumber());

                // Add a 20% buffer to the fee
                estimatedFee = estimatedFee.multipliedBy(1.2).integerValue(BigNumber.ROUND_CEIL);
                console.log('Estimated fee with buffer:', estimatedFee.toNumber());

                // Ensure the fee meets the minimum requirement
                const minRequiredFee = new BigNumber(currentFeeRates.minimumFee).multipliedBy(estimatedVsize);
                let finalFee = BigNumber.max(estimatedFee, minRequiredFee);
                console.log('Initial final fee:', finalFee.toNumber());

                // Update the PSBT with the final fee
                const changeOutput = psbt.txOutputs.find(output => output.address === paymentAddress);
                if (changeOutput) {
                        const newChangeValue = changeOutput.value - finalFee.minus(estimatedFee).toNumber();
                        if (newChangeValue >= 546) { // Dust threshold
                                changeOutput.value = newChangeValue;
                        } else {
                                // If change is less than dust threshold, add it to the fee
                                psbt.txOutputs = psbt.txOutputs.filter(output => output !== changeOutput);
                                finalFee = finalFee.plus(changeOutput.value);
                        }
                } else {
                        // If no change output, reduce the payment amount
                        const paymentOutput = psbt.txOutputs.find(output => output.address === recipientAddress);
                        if (paymentOutput) {
                                paymentOutput.value -= finalFee.minus(estimatedFee).toNumber();
                        } else {
                                throw new Error('Unable to adjust fee: no suitable output found');
                        }
                }

                console.log('PSBT after fee adjustment:', psbt.toBase64());

                // Recalculate actual fee after adjustments
                const totalInput = new BigNumber(psbt.inputsValue);
                const totalOutput = new BigNumber(psbt.txOutputs.reduce((sum, output) => sum + output.value, 0));
                finalFee = totalInput.minus(totalOutput);
                console.log('Actual final fee after adjustments:', finalFee.toNumber());

                const feeValidationError = validateFee(finalFee, totalInput);
                if (feeValidationError) {
                        throw new Error(feeValidationError);
                }

                if (totalInput.isLessThan(new BigNumber(amountSatoshis).plus(finalFee))) {
                        throw new Error(`Insufficient funds. Required: ${new BigNumber(amountSatoshis).plus(finalFee)}, Available: ${totalInput}`);
                }

                return {
                        success: true,
                        psbt: psbt.toBase64(),
                        fee: finalFee.toNumber(),
                        feeRate: feeRate,
                        totalInput: totalInput.toNumber(),
                        totalOutput: totalOutput.toNumber()
                };
        } catch (error) {
                console.error('Error in sendBitcoin:', error);
                return { success: false, error: error.message || 'Unknown error occurred' };
        }
}

export async function confirmAndBroadcastTransaction(psbtBase64) {
        try {
                const wallet = await getCurrentWallet();
                let wif = await getWIF(wallet);
                const keyPair = ECPair.fromWIF(wif, NETWORK);

                const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

                // Signing inputs
                psbt.data.inputs.forEach((input, index) => {
                        try {
                                psbt.signInput(index, keyPair);
                                console.log(`Input ${index} signed successfully`);
                        } catch (error) {
                                console.error(`Error signing input ${index}:`, error);
                                throw error;
                        }
                });

                console.log('PSBT after signing all inputs:', psbt.toBase64());

                const signedInputs = psbt.data.inputs.filter(input =>
                        (input.partialSig && input.partialSig.length > 0) ||
                        (input.finalScriptSig) ||
                        (input.finalScriptWitness)
                );
                if (signedInputs.length !== psbt.data.inputs.length) {
                        throw new Error(`Not all inputs were signed. Signed: ${signedInputs.length}, Total: ${psbt.data.inputs.length}`);
                }

                console.log('All signatures validated successfully');

                try {
                        psbt.finalizeAllInputs();
                        console.log('PSBT finalized successfully');
                } catch (error) {
                        console.error('Error finalizing PSBT:', error);
                        throw error;
                }

                const tx = psbt.extractTransaction();
                console.log('Transaction extracted successfully');

                const txHex = tx.toHex();
                console.log('Transaction hex:', txHex);

                const result = await broadcastTransaction(txHex);
                console.log('broadcastTransaction result:', result);

                if (result) {
                        return { success: true, txid: result };
                } else {
                        console.error('Transaction failed:', result);
                        return { success: false, error: 'Failed to broadcast transaction' };
                }
        } catch (error) {
                console.error('Error in confirmAndBroadcastTransaction:', error);
                return { success: false, error: error.message || 'Unknown error occurred' };
        }
}

async function getWIF(wallet) {
        let wif;
        if (wallet.wif) {
                wif = wallet.wif;
                console.log('Using unencrypted WIF');
        } else if (wallet.encryptedWIF) {
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
        return wif;
}