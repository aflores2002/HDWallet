import * as bitcoin from 'bitcoinjs-lib';
import axios from 'axios';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet; // Change to bitcoin.networks.bitcoin for mainnet

// export function createDummyPsbt(paymentAddress, paymentPublicKey) {
//         const psbt = new bitcoin.Psbt({ network });
//         const pubkey = Buffer.from(paymentPublicKey, 'hex');
//         const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network });

//         const dummyUtxo = {
//                 hash: '0000000000000000000000000000000000000000000000000000000000000000',
//                 index: 0,
//                 value: 100000, // 0.001 BTC
//         };

//         psbt.addInput({
//                 hash: dummyUtxo.hash,
//                 index: dummyUtxo.index,
//                 witnessUtxo: {
//                         script: p2wpkh.output,
//                         value: dummyUtxo.value,
//                 },
//         });

//         psbt.addOutput({
//                 address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', // Example testnet address
//                 value: 50000, // 0.0005 BTC
//         });

//         return psbt;
// }

export async function getPaymentUtxos(address) {
        try {
                const response = await fetch(`https://mempool.space/testnet/api/address/${address}/utxo`);
                const utxos = await response.json();
                console.log('Raw UTXO data:', utxos);
                return utxos.filter(utxo => utxo.status.confirmed);
        } catch (error) {
                console.error('Error fetching UTXOs:', error);
                throw new Error('Failed to get payment utxos');
        }
}

export async function createPsbt(senderAddress, recipientAddress, amountInSatoshis, feeRate = 1) {
        console.log('Creating PSBT with params:', { senderAddress, recipientAddress, amountInSatoshis, feeRate });
        const network = bitcoin.networks.testnet;
        const psbt = new bitcoin.Psbt({ network });

        const utxos = await getPaymentUtxos(senderAddress);
        console.log('Fetched UTXOs:', utxos);

        if (utxos.length === 0) {
                throw new Error('No UTXOs available');
        }

        let totalInput = 0;
        for (const utxo of utxos) {
                const txHex = await fetchTransactionHex(utxo.txid);
                const tx = bitcoin.Transaction.fromHex(txHex);
                const input = {
                        hash: utxo.txid,
                        index: utxo.vout,
                        witnessUtxo: tx.outs[utxo.vout],
                };

                // Only add witnessScript if pubkey is available
                if (utxo.pubkey) {
                        input.witnessScript = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(utxo.pubkey, 'hex') }).output;
                }

                psbt.addInput(input);
                totalInput += utxo.value;
        }

        psbt.addOutput({
                address: recipientAddress,
                value: amountInSatoshis,
        });

        const estimatedFee = (psbt.inputCount * 180 + 2 * 34 + 10) * feeRate;
        const changeAmount = totalInput - amountInSatoshis - estimatedFee;

        if (changeAmount > 546) {
                psbt.addOutput({
                        address: senderAddress,
                        value: changeAmount,
                });
        }

        console.log('Created PSBT:', psbt.toHex());
        return psbt.toHex();
}

async function fetchTransactionHex(txid) {
        const response = await fetch(`https://blockstream.info/testnet/api/tx/${txid}/hex`);
        return await response.text();
}

export function signPsbt(psbtHex, wif) {
        const network = bitcoin.networks.testnet;
        const psbt = bitcoin.Psbt.fromHex(psbtHex, { network });
        const keyPair = ECPair.fromWIF(wif, network);

        for (let i = 0; i < psbt.inputCount; i++) {
                psbt.signInput(i, keyPair);
        }

        console.log('Signed PSBT:', psbt.toHex());
        return psbt.toHex();
}

export async function broadcastTransaction(psbtHex) {
        try {
                const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: bitcoin.networks.testnet });
                console.log('PSBT before finalization:', psbt.toHex());

                // Create a validator function
                const validator = (pubkey, msghash, signature) => ECPair.fromPublicKey(pubkey).verify(msghash, signature);

                for (let i = 0; i < psbt.inputCount; i++) {
                        try {
                                psbt.validateSignaturesOfInput(i, validator);
                                psbt.finalizeInput(i);
                        } catch (error) {
                                console.error(`Error finalizing input ${i}:`, error);
                                throw error;
                        }
                }

                const tx = psbt.extractTransaction();
                const txHex = tx.toHex();
                console.log('Finalized transaction hex:', txHex);

                const response = await axios.post('https://mempool.space/testnet/api/tx', txHex);
                return { success: true, txid: response.data };
        } catch (error) {
                console.error('Error broadcasting transaction:', error);
                return { success: false, error: error.response ? error.response.data : error.message };
        }
}

function toXOnly(pubKey) {
        return pubKey.length === 32 ? pubKey : pubKey.slice(1, 33);
}