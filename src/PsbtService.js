// PsbtService.js
import * as bitcoin from 'bitcoinjs-lib';
import axios from 'axios';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet; // Change to bitcoin.networks.bitcoin for mainnet

let reservedUtxos = new Set();

export async function getPaymentUtxos(address, retries = 3) {
        for (let i = 0; i < retries; i++) {
                try {
                        const response = await fetch(`https://mempool.space/testnet/api/address/${address}/utxo`);
                        if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const utxos = await response.json();
                        console.log('Raw UTXO data:', utxos);
                        const availableUtxos = utxos.filter(utxo =>
                                utxo.status.confirmed && !reservedUtxos.has(`${utxo.txid}:${utxo.vout}`)
                        );
                        console.log('Available UTXOs:', availableUtxos);
                        return availableUtxos;
                } catch (error) {
                        console.error(`Error fetching UTXOs (attempt ${i + 1}/${retries}):`, error);
                        if (i === retries - 1) throw error;
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retrying
                }
        }
}

function reserveUtxos(utxos) {
        utxos.forEach(utxo => {
                const utxoKey = `${utxo.txid}:${utxo.vout}`;
                reservedUtxos.add(utxoKey);
                console.log(`Reserved UTXO: ${utxoKey}`);
        });
        console.log('All reserved UTXOs:', Array.from(reservedUtxos));
}

export function releaseUtxos(utxos) {
        utxos.forEach(utxo => {
                const utxoKey = `${utxo.txid}:${utxo.vout}`;
                if (reservedUtxos.has(utxoKey)) {
                        reservedUtxos.delete(utxoKey);
                        console.log(`Released UTXO: ${utxoKey}`);
                } else {
                        console.warn(`Attempted to release unreserved UTXO: ${utxoKey}`);
                }
        });
        console.log('Remaining reserved UTXOs:', Array.from(reservedUtxos));
}

export function resetUtxoState() {
        const previouslyReserved = Array.from(reservedUtxos);
        reservedUtxos.clear();
        console.log('UTXO state reset. Previously reserved UTXOs:', previouslyReserved);
}

export async function createPsbt(senderAddress, recipientAddress, amountInSatoshis, feeRate = 1) {
        console.log('Creating PSBT with params:', { senderAddress, recipientAddress, amountInSatoshis, feeRate });

        if (!senderAddress || !recipientAddress || !amountInSatoshis || isNaN(amountInSatoshis)) {
                throw new Error('Invalid parameters for createPsbt');
        }

        const psbt = new bitcoin.Psbt({ network });

        const utxos = await getPaymentUtxos(senderAddress);
        console.log('Fetched UTXOs:', utxos);

        if (utxos.length === 0) {
                throw new Error('No UTXOs available');
        }

        let totalInput = 0;
        const usedUtxos = [];
        for (const utxo of utxos) {
                const txHex = await fetchTransactionHex(utxo.txid);
                const tx = bitcoin.Transaction.fromHex(txHex);
                const input = {
                        hash: utxo.txid,
                        index: utxo.vout,
                        witnessUtxo: tx.outs[utxo.vout],
                };

                if (utxo.pubkey) {
                        input.witnessScript = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(utxo.pubkey, 'hex') }).output;
                }

                psbt.addInput(input);
                totalInput += utxo.value;
                usedUtxos.push(utxo);

                if (totalInput >= amountInSatoshis + (psbt.inputCount * 180 + 2 * 34 + 10) * feeRate) {
                        break;  // We have enough inputs
                }
        }

        if (totalInput < amountInSatoshis + (psbt.inputCount * 180 + 2 * 34 + 10) * feeRate) {
                throw new Error('Insufficient funds');
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

        reserveUtxos(usedUtxos);
        console.log('Created PSBT:', psbt.toHex());
        return { psbtHex: psbt.toHex(), usedUtxos };
}

async function fetchTransactionHex(txid) {
        try {
                const response = await fetch(`https://blockstream.info/testnet/api/tx/${txid}/hex`);
                return await response.text();
        } catch (error) {
                console.error('Error fetching transaction hex:', error);
                throw new Error('Failed to fetch transaction hex: ' + error.message);
        }
}

export function signPsbt(psbtHex, wif) {
        console.log('Signing PSBT');
        const psbt = bitcoin.Psbt.fromHex(psbtHex, { network });
        const keyPair = ECPair.fromWIF(wif, network);

        try {
                for (let i = 0; i < psbt.inputCount; i++) {
                        psbt.signInput(i, keyPair);
                }

                console.log('Signed PSBT:', psbt.toHex());
                return psbt.toHex();
        } catch (error) {
                console.error('Error signing PSBT:', error);
                throw new Error('Failed to sign PSBT: ' + error.message);
        }
}

export function rejectPsbt(psbtHex) {
        console.log('Rejecting PSBT');
        const psbt = bitcoin.Psbt.fromHex(psbtHex, { network });
        const utxosToRelease = psbt.txInputs.map(input => ({
                txid: Buffer.from(input.hash).reverse().toString('hex'),
                vout: input.index
        }));
        console.log('UTXOs to release:', utxosToRelease);
        releaseUtxos(utxosToRelease);
        console.log('PSBT rejected, UTXOs released');
}

export async function broadcastTransaction(psbtHex) {
        try {
                console.log('Attempting to broadcast transaction with PSBT:', psbtHex);
                if (typeof psbtHex !== 'string' || psbtHex.trim() === '') {
                        throw new Error('Invalid PSBT: expected non-empty hex string');
                }
                const psbt = bitcoin.Psbt.fromHex(psbtHex, { network });
                console.log('PSBT parsed successfully');
                console.log('PSBT before finalization:', psbt.toHex());

                const validator = (pubkey, msghash, signature) => ECPair.fromPublicKey(pubkey).verify(msghash, signature);

                for (let i = 0; i < psbt.inputCount; i++) {
                        try {
                                console.log(`Validating and finalizing input ${i}`);
                                psbt.validateSignaturesOfInput(i, validator);
                                psbt.finalizeInput(i);
                                console.log(`Input ${i} finalized successfully`);
                        } catch (error) {
                                console.error(`Error finalizing input ${i}:`, error);
                                releaseUtxos(psbt.txInputs);
                                throw new Error(`Failed to finalize input ${i}: ${error.message}`);
                        }
                }

                const tx = psbt.extractTransaction();
                const txHex = tx.toHex();
                console.log('Finalized transaction hex:', txHex);

                console.log('Sending transaction to mempool.space API');
                const response = await axios.post('https://mempool.space/testnet/api/tx', txHex);
                console.log('API response:', response.data);

                releaseUtxos(psbt.data.inputs);  // Release UTXOs after successful broadcast
                console.log('Transaction broadcast successfully. TXID:', response.data);
                return { success: true, txid: response.data, message: 'Transaction broadcast successfully' };
        } catch (error) {
                console.error('Error broadcasting transaction:', error);
                if (psbtHex) {
                        try {
                                const psbt = bitcoin.Psbt.fromHex(psbtHex, { network });
                                releaseUtxos(psbt.data.inputs);  // Release UTXOs if broadcast fails
                        } catch (innerError) {
                                console.error('Error releasing UTXOs:', innerError);
                        }
                } return {
                        success: false,
                        error: error.response ? error.response.data : error.message,
                        message: 'Failed to broadcast transaction'
                };
        }
}