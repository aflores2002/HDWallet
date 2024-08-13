import * as bitcoin from 'bitcoinjs-lib';
import axios from 'axios';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet; // Change to bitcoin.networks.bitcoin for mainnet

export function createDummyPsbt(paymentAddress, paymentPublicKey) {
        const psbt = new bitcoin.Psbt({ network });
        const pubkey = Buffer.from(paymentPublicKey, 'hex');
        const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network });

        const dummyUtxo = {
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
                value: 100000, // 0.001 BTC
        };

        psbt.addInput({
                hash: dummyUtxo.hash,
                index: dummyUtxo.index,
                witnessUtxo: {
                        script: p2wpkh.output,
                        value: dummyUtxo.value,
                },
        });

        psbt.addOutput({
                address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', // Example testnet address
                value: 50000, // 0.0005 BTC
        });

        return psbt;
}

export function signPsbt(psbtHex, wif) {
        const psbt = bitcoin.Psbt.fromHex(psbtHex, { network });
        const keyPair = ECPair.fromWIF(wif, network);

        psbt.signAllInputs(keyPair);

        // Add a custom validator function
        const validator = (pubkey, msghash, signature) => ECPair.fromPublicKey(pubkey).verify(msghash, signature);

        if (!psbt.validateSignaturesOfAllInputs(validator)) {
                throw new Error('PSBT signature validation failed');
        }

        psbt.finalizeAllInputs();
        return psbt.toHex();
}

export async function broadcastTransaction(txHex) {
        try {
                const response = await axios.post('https://mempool.space/testnet/api/tx', txHex);
                return { success: true, txid: response.data };
        } catch (error) {
                console.error('Error broadcasting transaction:', error);
                let errorMessage = 'Unknown error occurred';
                if (error.response) {
                        // The request was made and the server responded with a status code
                        // that falls out of the range of 2xx
                        errorMessage = `Server responded with error ${error.response.status}: ${error.response.data}`;
                } else if (error.request) {
                        // The request was made but no response was received
                        errorMessage = 'No response received from server';
                } else {
                        // Something happened in setting up the request that triggered an Error
                        errorMessage = error.message;
                }
                return { success: false, error: errorMessage };
        }
}

export async function getPaymentUtxos(address) {
        try {
                const response = await axios.get(`https://mempool.space/testnet/api/address/${address}/utxo`);
                return response.data.filter(utxo => utxo.status.confirmed);
        } catch (error) {
                console.error('Error fetching UTXOs:', error);
                throw new Error('Failed to get payment utxos');
        }
}

function toXOnly(pubKey) {
        return pubKey.length === 32 ? pubKey : pubKey.slice(1, 33);
}