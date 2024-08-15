import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

function magicHash(message, network) {
    const messagePrefix = network.messagePrefix || '\x18Bitcoin Signed Message:\n';
    const messageBuffer = Buffer.from(message);
    return bitcoin.crypto.hash256(Buffer.concat([
        Buffer.from([messagePrefix.length]),
        Buffer.from(messagePrefix),
        Buffer.from([messageBuffer.length]),
        messageBuffer
    ]));
}

export function signMessage(message, wif) {
    console.log('Signing message:', message);
    console.log('WIF provided:', wif ? 'Yes' : 'No');

    if (!message || typeof message !== 'string') {
        throw new Error('Invalid message: must be a non-empty string');
    }

    if (!wif || typeof wif !== 'string') {
        throw new Error('Invalid WIF: must be a non-empty string');
    }

    try {
        const network = bitcoin.networks.testnet; // or bitcoin.networks.bitcoin for mainnet
        console.log('Network:', network);

        const keyPair = ECPair.fromWIF(wif, network);
        console.log('KeyPair created successfully');

        if (!keyPair.privateKey) {
            throw new Error('Private key is missing from the key pair');
        }

        const messageHash = magicHash(message, network);
        console.log('Message hash created');

        const signature = keyPair.sign(messageHash);
        console.log('Message signed successfully');
        console.log('Signature:', signature);

        const signatureBuffer = Buffer.alloc(65);
        signatureBuffer.writeUInt8(31, 0); // recovery id + 27 + 4 (for compressed)
        signature.slice(0, 32).copy(signatureBuffer, 1);  // r value
        signature.slice(32, 64).copy(signatureBuffer, 33); // s value

        return signatureBuffer.toString('base64');
    } catch (error) {
        console.error('Error in signMessage:', error);
        console.error('Error stack:', error.stack);
        throw error;
    }
}

export function verifyMessage(message, address, signature) {
    try {
        const network = bitcoin.networks.testnet;
        const messageHash = magicHash(message, network);

        const signatureBuffer = Buffer.from(signature, 'base64');
        if (signatureBuffer.length !== 65) throw new Error('Invalid signature length');

        const flagByte = signatureBuffer[0] - 27 - 4;
        const recoveryId = flagByte & 3;
        const compressedFlag = !!(flagByte & 4);

        const r = signatureBuffer.slice(1, 33);
        const s = signatureBuffer.slice(33);

        const publicKey = ecc.recover(messageHash, Buffer.concat([r, s]), recoveryId, compressedFlag);

        const keyPair = ECPair.fromPublicKey(Buffer.from(publicKey));

        const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
        const p2sh = bitcoin.payments.p2sh({ redeem: p2wpkh, network });
        const p2pkh = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

        const derivedAddresses = [
            p2wpkh.address,  // Native SegWit (bech32)
            p2sh.address,    // Nested SegWit
            p2pkh.address    // Legacy
        ];

        console.log('Recovered addresses:', derivedAddresses);
        console.log('Given address:', address);

        return derivedAddresses.includes(address);
    } catch (error) {
        console.error('Error verifying message:', error);
        throw error;
    }
}