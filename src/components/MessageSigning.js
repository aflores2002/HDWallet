import * as bitcoin from 'bitcoinjs-lib'
import * as bitcoinMessage from 'bitcoinjs-message'

export async function signMessage(message, wif){
    // Replace with your own WIF (Wallet Import Format) private key
    const keyPair = bitcoin.ECPair.fromWIF(wif);
    const privateKey = keyPair.privateKey;

    const signature = bitcoinMessage.sign(message, privateKey, keyPair.compressed);
    console.log(signature.toString('base64'));
    return signature;
}