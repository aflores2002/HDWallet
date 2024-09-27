// src/utils/fee.js
import axios from 'axios';
import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import { toXOnly } from './transaction';

const production = true;
const network = bitcoin.networks.testnet;

const DUST = 330;

const getNetworkFee = (psbt) => {
        const inputValue = psbt.txInputs.reduce((sum, input, index) => {
                const witnessUtxo = psbt.data.inputs[index].witnessUtxo;
                return sum + (witnessUtxo ? witnessUtxo.value : 0);
        }, 0);

        const outputValue = psbt.txOutputs.reduce((sum, output) => sum + output.value, 0);

        return inputValue - outputValue;
};

const getMinFee = async () => {
        if (!production) {
                return 0;
        }

        try {
                const response = await fetch('https://mempool.space/api/v1/fees/recommended');
                if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                return Math.floor(Number(data.minimumFee));
        } catch (error) {
                console.error('Error fetching fee rate:', error);
                return 1; // Return a default fee rate if fetching fails
        }
};

const addPaymentInputs = (psbt, feeRate, paymentUtxos, redeemScript, paymentAddress, paymentScript, paymentTapInternalKey, estimateKeyPair, tweakedEstimateSigner, walletProvider, estimatorRunestone, network) => {
        console.log('addPaymentInputs called with params:', {
                feeRate, paymentUtxos, redeemScript, paymentAddress, paymentScript,
                paymentTapInternalKey: paymentTapInternalKey.toString('hex'),
                walletProvider, network
        });

        const utxos = paymentUtxos.sort((a, b) => {
                const amountA = Math.floor(Number(a.satoshis || 0));
                const amountB = Math.floor(Number(b.satoshis || 0));
                return amountB - amountA;
        });

        console.log('Sorted UTXOs:', utxos);

        let inputSats = psbt.data.inputs.reduce((total, input) => total + (input.witnessUtxo ? Math.floor(input.witnessUtxo.value) : 0), 0);
        const outputSats = psbt.txOutputs.reduce((total, output) => total + Math.floor(output.value), 0);

        console.log('Initial inputSats:', inputSats);
        console.log('outputSats:', outputSats);

        let change = false;
        let fee = 0;
        let feeWithChange;

        if (inputSats > outputSats + DUST) {
                const { size, sizeWithChange } = getPsbtSize(psbt, estimateKeyPair, tweakedEstimateSigner, paymentAddress, estimatorRunestone, network);

                fee = Math.floor(feeRate * size);
                feeWithChange = Math.floor(feeRate * sizeWithChange);

                console.log('Estimated fee:', fee);
                console.log('Estimated fee with change:', feeWithChange);

                if (inputSats >= outputSats + fee) {
                        if (inputSats - (feeWithChange + outputSats) >= DUST) {
                                psbt.addOutput({
                                        address: paymentAddress,
                                        value: Math.floor(inputSats - (feeWithChange + outputSats)),
                                });
                                change = true;
                                console.log('Change output added');
                        }

                        return { change };
                }
        }

        for (const utxo of utxos) {
                const witnessUtxo = {
                        script: Buffer.from(paymentScript, 'hex'),
                        value: Math.floor(Number(utxo.satoshis)),
                };

                console.log('Adding input:', { txid: utxo.txid, vout: utxo.vout, witnessUtxo });

                if (walletProvider === 'hdwallet') {
                        psbt.addInput({
                                hash: utxo.txid,
                                index: utxo.vout,
                                witnessUtxo: {
                                        script: Buffer.from(paymentScript, 'hex'),
                                        value: utxo.satoshis,
                                },
                        });
                } else if (walletProvider === 'leather') {
                        psbt.addInput({
                                hash: utxo.txid,
                                index: utxo.vout,
                                witnessUtxo: {
                                        script: Buffer.from(paymentScript, 'hex'),
                                        value: utxo.satoshis,
                                },
                        });
                } else {
                        psbt.addInput({
                                hash: utxo.txid,
                                index: utxo.vout,
                                witnessUtxo: {
                                        script: Buffer.from(paymentScript, 'hex'),
                                        value: utxo.satoshis,
                                },
                        });
                }

                inputSats += Math.floor(Number(utxo.satoshis));
                console.log('Updated inputSats:', inputSats);

                if (inputSats < outputSats) {
                        continue;
                }

                const sizes = getPsbtSize(psbt, estimateKeyPair, tweakedEstimateSigner, paymentAddress, estimatorRunestone, network);
                fee = Math.floor(feeRate * sizes.size);
                feeWithChange = Math.floor(feeRate * sizes.sizeWithChange);

                console.log('Recalculated fee:', fee);
                console.log('Recalculated fee with change:', feeWithChange);

                if (inputSats >= outputSats + fee) {
                        if (inputSats - (feeWithChange + outputSats) >= DUST) {
                                psbt.addOutput({
                                        address: paymentAddress,
                                        value: Math.floor(inputSats - (feeWithChange + outputSats)),
                                });
                                change = true;
                                console.log('Change output added');
                        }

                        return { change };
                }
        }

        console.log('Insufficient funds');
        return { 'error': `Sorry, you have an insufficient amount of funds for the transfer. You need at least ${fee + outputSats} sats.` };
};

const getPsbtSize = (
        psbt,
        estimateKeyPair,
        tweakedEstimateSigner,
        paymentAddress,
        estimatorRunestone,
        network
) => {
        const estimatedPsbt = psbt.clone();
        const estimatedPsbtWithChange = psbt.clone();

        estimatedPsbt.setMaximumFeeRate(100000000);
        estimatedPsbtWithChange.setMaximumFeeRate(100000000);

        estimatedPsbtWithChange.addOutput({
                address: paymentAddress,
                value: DUST,
        });

        if (estimatorRunestone) {
                estimatedPsbt.addOutput({
                        script: estimatorRunestone,
                        value: 0,
                });
                estimatedPsbtWithChange.addOutput({
                        script: estimatorRunestone,
                        value: 0,
                });
        }

        // Use placeholder signatures for size estimation
        const placeholderSignature = Buffer.alloc(64, 0);
        const placeholderWitness = [placeholderSignature];

        estimatedPsbt.data.inputs.forEach((input, index) => {
                if (input.witnessUtxo) {
                        // Add placeholder witness
                        estimatedPsbt.updateInput(index, { finalScriptWitness: bitcoin.script.compile(placeholderWitness) });
                }
        });

        estimatedPsbtWithChange.data.inputs.forEach((input, index) => {
                if (input.witnessUtxo) {
                        // Add placeholder witness
                        estimatedPsbtWithChange.updateInput(index, { finalScriptWitness: bitcoin.script.compile(placeholderWitness) });
                }
        });

        const transaction = estimatedPsbt.extractTransaction(true);
        const size = transaction.virtualSize();

        const transactionWithChange = estimatedPsbtWithChange.extractTransaction(true);
        const sizeWithChange = transactionWithChange.virtualSize();

        return { size, sizeWithChange };
};

export { getPsbtSize, addPaymentInputs, getMinFee, getNetworkFee };