import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

export function derivePublicKey(wif, network = bitcoin.networks.testnet) {
        console.log('Deriving public key from WIF:', wif);
        try {
                if (typeof wif !== 'string' || wif.trim() === '') {
                        throw new Error('Invalid WIF: must be a non-empty string');
                }
                const keyPair = ECPair.fromWIF(wif, network);
                const publicKey = keyPair.publicKey.toString('hex');
                console.log('Derived public key:', publicKey);
                return publicKey;
        } catch (error) {
                console.error('Error deriving public key:', error);
                throw error;
        }
}