// src/wallet/index.js
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import ECPairFactory from 'ecpair';

// Initialize BIP32
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

export const generateMnemonic = () => {
        return bip39.generateMnemonic();
};

export const walletFromSeedPhrase = async ({ mnemonic, index = 0, network = 'Testnet' }) => {
        const seed = await bip39.mnemonicToSeed(mnemonic);
        const networkParams = network === 'Testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

        const root = bip32.fromSeed(seed, networkParams);
        const path = `m/44'/0'/0'/0/${index}`;
        const child = root.derivePath(path);

        const keyPair = ECPair.fromPrivateKey(child.privateKey, { network: networkParams });
        const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: networkParams });

        return {
                mnemonic,
                wif: keyPair.toWIF(),
                address,
                publicKey: child.publicKey.toString('hex'),
                path
        };
};

export const validateBtcAddress = (address, network = 'Testnet') => {
        try {
                const networkParams = network === 'Testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
                bitcoin.address.toOutputScript(address, networkParams);
                return true;
        } catch (error) {
                return false;
        }
};

// If you need STX address validation, you might want to implement it or use a Stacks-specific library
export const validateStxAddress = (address) => {
        // Implement STX address validation logic here
        // This is a placeholder and should be replaced with actual validation
        return address.startsWith('ST');
};