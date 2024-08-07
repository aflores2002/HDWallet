import * as bitcoin from 'bitcoinjs-lib';
import ky from 'ky';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';

// Initialize ECPair
const ECPair = ECPairFactory(ecc);

const SIGNET = bitcoin.networks.signet;
const MAINNET = bitcoin.networks.bitcoin;

// Choose network (change to MAINNET when ready for production)
const NETWORK = SIGNET;

const MEMPOOL_API = NETWORK === SIGNET
        ? 'https://mempool.space/signet/api'
        : 'https://mempool.space/api';

async function getUTXOs(address) {
        const response = await ky.get(`${MEMPOOL_API}/address/${address}/utxo`).json();
        return response;
}

async function getCurrentFeeRate() {
        const response = await ky.get(`${MEMPOOL_API}/v1/fees/recommended`).json();
        return response.halfHourFee; // satoshis per byte
}

async function broadcastTransaction(txHex) {
        const response = await ky.post(`${MEMPOOL_API}/tx`, { body: txHex }).text();
        return response; // This should be the transaction ID
}

export async function sendBitcoin(senderWIF, recipientAddress, amountBTC, feeRate = null) {
        try {
                if (!senderWIF) {
                        throw new Error('Sender WIF is not provided');
                }

                const keyPair = ECPair.fromWIF(senderWIF, NETWORK);
                const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK });

                const utxos = await getUTXOs(address);
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

                const amountSatoshis = Math.floor(amountBTC * 100000000);
                psbt.addOutput({
                        address: recipientAddress,
                        value: amountSatoshis,
                });

                if (!feeRate) {
                        feeRate = await getCurrentFeeRate();
                }

                // Estimate transaction size and calculate fee
                const estimatedSize = utxos.length * 180 + 2 * 34 + 10; // Rough estimate
                const fee = estimatedSize * feeRate;

                if (totalInput < amountSatoshis + fee) {
                        throw new Error('Insufficient funds');
                }

                // Add change output if necessary
                const change = totalInput - amountSatoshis - fee;
                if (change > 546) { // Dust threshold
                        psbt.addOutput({
                                address: address,
                                value: change,
                        });
                }

                // Sign inputs
                utxos.forEach((_, index) => {
                        psbt.signInput(index, keyPair);
                });

                psbt.finalizeAllInputs();

                const tx = psbt.extractTransaction();
                const txHex = tx.toHex();

                // Broadcast transaction
                const txid = await broadcastTransaction(txHex);
                return txid;

        } catch (error) {
                console.error('Error sending Bitcoin:', error);
                throw error;
        }
}