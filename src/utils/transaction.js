// src/utils/transaction.js
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import { Buffer } from 'buffer';

// Initialize the elliptic curve library
bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

export function getVirtualSize(psbt) {
        // Estimate the virtual size based on the number of inputs and outputs
        const inputCount = psbt.data.inputs.length;
        const outputCount = psbt.data.outputs.length;

        // Rough estimate:
        // 10 bytes for version, locktime
        // 1 byte for input count, 1 byte for output count
        // 32 bytes for each input (simplified)
        // 31 bytes for each output (simplified)
        // Add some buffer for potential witnesses
        const estimatedVsize = Math.ceil((10 + 1 + 1 + (inputCount * 32) + (outputCount * 31) + (inputCount * 20)) * 1.05);

        return estimatedVsize;
}

const tweakSigner = (signer, opts) => {
        let privateKey = signer.privateKey;
        if (!privateKey) {
                throw new Error('Private key is required for tweaking signer!');
        }
        if (signer.publicKey[0] === 3) {
                privateKey = ecc.privateNegate(privateKey);
        }

        const tweakedPrivateKey = ecc.privateAdd(
                privateKey,
                tapTweakHash(toXOnly(signer.publicKey), opts.tweakHash),
        );
        if (!tweakedPrivateKey) {
                throw new Error('Invalid tweaked private key!');
        }

        return ECPair.fromPrivateKey(Buffer.from(tweakedPrivateKey), {
                network: opts.network,
        });
};

const tapTweakHash = (pubKey, h) => {
        return bitcoin.crypto.taggedHash(
                'TapTweak',
                Buffer.concat(h ? [pubKey, h] : [pubKey]),
        );
};

export const toXOnly = (pubKey) => {
        return pubKey.length === 32 ? pubKey : pubKey.slice(1, 33);
};

const estimateKeyPair = ECPair.makeRandom({ network });
const tweakedEstimateSigner = tweakSigner(estimateKeyPair, { network });