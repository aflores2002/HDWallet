// src/utils/transaction.js
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import ECPairFactory from 'ecpair';
import { Buffer } from 'buffer';

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

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