import * as bip39 from 'bip39';
import * as hdkey from 'hdkey';
import createHash from 'create-hash';
import bs58check from 'bs58check';

export const generateMnemonic = () => {
        return bip39.generateMnemonic();
};

export const walletFromSeedPhrase = async ({ mnemonic, index = 0, network = 'Mainnet' }) => {
        const seed = await bip39.mnemonicToSeed(mnemonic);
        const root = hdkey.fromMasterSeed(seed);
        const masterPrivateKey = root.privateKey.toString('hex');
        const xpub = root.publicExtendedKey;

        // Derive the address (m/44'/0'/0'/0/0 for first Bitcoin address)
        const addrNode = root.derive("m/44'/0'/0'/0/" + index);

        const step1 = addrNode._publicKey;
        const step2 = createHash('sha256').update(step1).digest();
        const step3 = createHash('rmd160').update(step2).digest();

        const step4 = Buffer.allocUnsafe(21);
        step4.writeUInt8(network === 'Mainnet' ? 0x00 : 0x6f, 0);
        step3.copy(step4, 1);

        const address = bs58check.encode(step4);

        return {
                mnemonic,
                xpub,
                //masterPrivateKey,
                address,
                publicKey: step1.toString('hex'),
        };
};