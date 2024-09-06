// src/psbtGenerator.js
import * as bitcoin from 'bitcoinjs-lib';
import { Psbt } from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { addPaymentInputs } from './utils/fee.js';
import { toXOnly } from './utils/transaction';
import { Buffer } from 'buffer';

const network = bitcoin.networks.testnet;
const ECPair = ECPairFactory(ecc);

// Create a dummy key pair for estimation
const dummyKeyPair = ECPair.makeRandom({ network });

// Create a tweaked signer for P2TR inputs
const tweakedSigner = (signer) => {
        const tweakedPrivateKey = bitcoin.crypto.taggedHash('TapTweak', signer.publicKey.slice(1, 33));
        const tweakedPublicKey = Buffer.from(ecc.pointAddScalar(signer.publicKey.slice(1, 33), tweakedPrivateKey));
        return {
                publicKey: Buffer.concat([Buffer.from([0x02 | (tweakedPublicKey[31] & 1)]), tweakedPublicKey.slice(0, 32)]),
                sign: (hash) => {
                        const signatureBuffer = Buffer.alloc(64);
                        ecc.signSchnorr(hash, tweakedPrivateKey, signatureBuffer);
                        return signatureBuffer;
                }
        };
};

export const generateTransferPsbt = async (amount, toAddress, feeRate, type, user, isCustodial) => {
        console.log('generateTransferPsbt called with params:', { amount, toAddress, feeRate, type, user, isCustodial });

        try {
                let result = {};
                let paymentUtxos, paymentAddress, paymentPublicKey, paymentWalletProvider;

                if (type === 'deposit' || (type === 'standard' && !isCustodial)) {
                        paymentAddress = user.paymentAddress;
                        paymentPublicKey = user.paymentPublicKey;
                        paymentUtxos = Array.isArray(user.paymentUtxos) ? user.paymentUtxos.map(utxo => ({
                                ...utxo,
                                satoshis: Math.floor(Number(utxo.satoshis))
                        })) : [];
                        paymentWalletProvider = user.walletProvider;
                        isCustodial = false;
                } else {
                        paymentAddress = user.prefundAddress;
                        paymentPublicKey = user.prefundPublicKey;
                        paymentUtxos = Array.isArray(user.custodialPaymentUtxos) ? user.custodialPaymentUtxos.map(utxo => ({
                                ...utxo,
                                satoshis: Math.floor(Number(utxo.satoshis))
                        })) : [];
                        paymentWalletProvider = null;
                        isCustodial = true;
                }

                console.log('Payment UTXOs:', paymentUtxos);
                console.log('Payment Address:', paymentAddress);
                console.log('Payment Public Key:', paymentPublicKey);

                if (paymentUtxos.length === 0) {
                        throw new Error('No UTXOs available for payment');
                }

                // Convert paymentPublicKey to a Buffer
                let paymentPublicKeyBuffer;
                if (Buffer.isBuffer(paymentPublicKey)) {
                        paymentPublicKeyBuffer = paymentPublicKey;
                } else if (typeof paymentPublicKey === 'string') {
                        paymentPublicKeyBuffer = Buffer.from(paymentPublicKey, 'hex');
                } else {
                        throw new Error(`Invalid public key format: ${typeof paymentPublicKey}`);
                }

                console.log('Payment Public Key Buffer:', paymentPublicKeyBuffer.toString('hex'));

                if (paymentPublicKeyBuffer.length !== 33) {
                        throw new Error(`Invalid public key length: ${paymentPublicKeyBuffer.length}. Expected 33 bytes.`);
                }

                const paymentScript = bitcoin.payments.p2wpkh({ pubkey: paymentPublicKeyBuffer, network }).output;
                if (!paymentScript) {
                        throw new Error('Failed to generate payment script');
                }
                console.log('Payment Script:', paymentScript.toString('hex'));

                const paymentTapInternalKey = toXOnly(paymentPublicKeyBuffer);
                console.log('Payment Tap Internal Key:', paymentTapInternalKey.toString('hex'));

                const psbt = new Psbt({ network });

                psbt.addOutput({
                        address: toAddress,
                        value: Math.floor(Number(amount)),
                });

                console.log('PSBT before addPaymentInputs:', psbt);

                const paymentResult = addPaymentInputs(
                        psbt,
                        Math.floor(Number(feeRate)),
                        paymentUtxos,
                        null, // redeemScript is not needed for native SegWit
                        paymentAddress,
                        paymentScript.toString('hex'),
                        paymentTapInternalKey,
                        dummyKeyPair,
                        null, // We're not using a tweaked signer for now
                        paymentWalletProvider,
                        null, // estimatorRunestone
                        network
                );

                console.log('Payment Result:', paymentResult);
                console.log('PSBT after addPaymentInputs:', psbt);

                if (paymentResult.error) {
                        result.error = paymentResult.error;
                        return result;
                }

                const fee = getNetworkFee(psbt);
                console.log('Calculated network fee:', fee);

                const encodedPsbt = psbt.toBase64();

                result.psbt = encodedPsbt;
                result.indexes = [{ address: paymentAddress, signingIndexes: [] }];
                result.networkFee = fee;

                console.log('PSBT generation completed');
                return result;
        } catch (error) {
                console.error('Error in generateTransferPsbt:', error);
                throw error;
        }
};

const getNetworkFee = (psbt) => {
        console.log('Calculating network fee...');
        console.log('PSBT inputs:', JSON.stringify(psbt.data.inputs, null, 2));
        console.log('PSBT outputs:', JSON.stringify(psbt.data.outputs, null, 2));

        const inputValue = psbt.txInputs.reduce((sum, input, index) => {
                const witnessUtxo = psbt.data.inputs[index].witnessUtxo;
                if (!witnessUtxo) {
                        console.warn(`Missing witnessUtxo for input ${index}`);
                        return sum;
                }
                if (typeof witnessUtxo.value !== 'number') {
                        console.warn(`Invalid witnessUtxo value for input ${index}:`, witnessUtxo.value);
                        return sum;
                }
                return sum + Math.floor(witnessUtxo.value);
        }, 0);

        const outputValue = psbt.txOutputs.reduce((sum, output) => {
                if (typeof output.value !== 'number') {
                        console.warn('Invalid output value:', output.value);
                        return sum;
                }
                return sum + Math.floor(output.value);
        }, 0);

        console.log('Total input value:', inputValue);
        console.log('Total output value:', outputValue);

        return Math.max(0, inputValue - outputValue);
};