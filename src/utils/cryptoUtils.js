// src/utils/cryptoUtils.js
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { Buffer } from 'buffer';

const ECPair = ECPairFactory(ecc);

export function derivePublicKey(wif, network = bitcoin.networks.testnet) {
        console.log('Deriving public key from WIF:', wif);
        try {
                if (typeof wif !== 'string' || wif.trim() === '') {
                        throw new Error('Invalid WIF: must be a non-empty string');
                }
                const keyPair = ECPair.fromWIF(wif, network);
                const publicKey = Buffer.from(keyPair.publicKey).toString('hex');
                console.log('Derived public key:', publicKey);
                console.log('Derived public key length:', publicKey.length);
                console.log('Derived public key prefix:', publicKey.substring(0, 2));
                return publicKey;
        } catch (error) {
                console.error('Error deriving public key:', error);
                throw error;
        }
}