// src/PsbtService.js
import * as bitcoin from 'bitcoinjs-lib';
import axios from 'axios';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

// Initialize the elliptic curve library
bitcoin.initEccLib(ecc);

// Initialize ECPair
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
                        ).map(utxo => ({
                                ...utxo,
                                satoshis: Math.floor(Number(utxo.value))  // Ensure satoshis is an integer
                        }));
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

                console.log('Added input:', input);

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

        console.log('PSBT inputs:', psbt.txInputs);
        console.log('PSBT outputs:', psbt.txOutputs);

        reserveUtxos(usedUtxos);
        console.log('Created PSBT:', psbt.toHex());
        return { success: true, psbtHex: psbt.toHex(), usedUtxos };
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
                for (let i = 0; i < psbt.data.inputs.length; i++) {
                        psbt.signInput(i, keyPair);
                        console.log(`Input ${i} signed`);
                }

                console.log('All inputs signed');
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

export async function broadcastTransaction(txHex) {
        try {
                console.log('Attempting to broadcast transaction with hex:', txHex);
                const response = await fetch(`https://mempool.space/testnet/api/tx`, {
                        method: 'POST',
                        body: txHex,
                        headers: {
                                'Content-Type': 'text/plain',
                        },
                });

                if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Broadcast failed. Status:', response.status, 'Error:', errorText);
                        throw new Error(`Failed to broadcast transaction: ${response.status} ${response.statusText}. ${errorText}`);
                }

                const txid = await response.text();
                console.log('Transaction broadcast successful. TXID:', txid);
                return txid;
        } catch (error) {
                console.error('Error broadcasting transaction:', error);
                throw error;
        }
}