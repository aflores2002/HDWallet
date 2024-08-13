import React, { useState } from 'react';
import { derivePublicKey } from '../utils/cryptoUtils';

const TestWalletFunctions = ({ wallet }) => {
        const [message, setMessage] = useState('');
        const [signature, setSignature] = useState('');
        const [verificationResult, setVerificationResult] = useState('');
        const [psbtResult, setPsbtResult] = useState('');
        const [txid, setTxid] = useState('');
        const [warning, setWarning] = useState('');
        const [broadcastResult, setBroadcastResult] = useState('');

        const handleSignMessage = () => {
                chrome.runtime.sendMessage({
                        action: 'signMessage',
                        message,
                        wif: wallet.wif
                }, (response) => {
                        console.log('Received sign message response:', response);
                        if (response.success) {
                                setSignature(response.signature);
                                setVerificationResult('');
                        } else {
                                console.error('Error signing message:', response.error);
                                setSignature('');
                                setVerificationResult('Signing failed: ' + response.error);
                        }
                });
        };

        const handleVerifyMessage = () => {
                chrome.runtime.sendMessage({
                        action: 'verifyMessage',
                        message,
                        address: wallet.address,
                        signature
                }, (response) => {
                        console.log('Received verify message response:', response);
                        if (response.success) {
                                setVerificationResult(response.isValid ? 'Valid signature' : 'Invalid signature');
                        } else {
                                console.error('Error verifying message:', response.error);
                                setVerificationResult('Verification failed: ' + response.error);
                        }
                });
        };

        const handleCreateAndSignPsbt = () => {
                setWarning('');
                setPsbtResult('');
                setBroadcastResult('');
                console.log('Wallet object:', wallet);

                let publicKey;
                try {
                        publicKey = wallet.publicKey || derivePublicKey(wallet.wif);
                } catch (error) {
                        console.error('Error deriving public key:', error);
                        setPsbtResult('Error: Failed to derive public key - ' + error.message);
                        return;
                }

                console.log('Using public key:', publicKey);

                chrome.runtime.sendMessage({
                        action: 'createAndSignPsbt',
                        paymentAddress: wallet.address,
                        paymentPublicKey: publicKey,
                        wif: wallet.wif,
                        outputs: [{ address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', value: 1000 }]
                }, (response) => {
                        console.log('Received createAndSignPsbt response:', response);
                        if (response.success) {
                                setPsbtResult(response.signedPsbtHex);
                                if (response.isDummy) {
                                        setWarning('Warning: This is a dummy PSBT created for testing purposes. It cannot be broadcast to the network.');
                                }
                        } else {
                                console.error('Error creating and signing PSBT:', response.error);
                                setPsbtResult('Error: ' + response.error);
                        }
                });
        };

        const handleBroadcastTransaction = () => {
                if (!psbtResult) {
                        console.error('No signed PSBT available');
                        setBroadcastResult('Error: No signed PSBT available');
                        return;
                }

                chrome.runtime.sendMessage({
                        action: 'broadcastTransaction',
                        signedPsbtHex: psbtResult
                }, (response) => {
                        console.log('Received broadcastTransaction response:', response);
                        if (response.success) {
                                setTxid(response.txid);
                                setBroadcastResult(`Transaction broadcasted successfully. TXID: ${response.txid}`);
                        } else {
                                console.error('Error broadcasting transaction:', response.error);
                                setBroadcastResult(`Error broadcasting transaction: ${response.error}`);
                        }
                });
        };

        return (
                <div>
                        <h2>Test Wallet Functions</h2>
                        <div>
                                <h3>Message Signing and Verification</h3>
                                <input
                                        type="text"
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        placeholder="Enter message to sign"
                                />
                                <button onClick={handleSignMessage}>Sign Message</button>
                                {signature && (
                                        <>
                                                <p>Signature: {signature}</p>
                                                <button onClick={handleVerifyMessage}>Verify Message</button>
                                        </>
                                )}
                                {verificationResult && <p>Verification result: {verificationResult}</p>}
                        </div>
                        <div>
                                <h3>PSBT Operations</h3>
                                <button onClick={handleCreateAndSignPsbt}>Create and Sign PSBT</button>
                                {warning && <p style={{ color: 'orange' }}>{warning}</p>}
                                {psbtResult && (
                                        <>
                                                <p>Signed PSBT: {psbtResult}</p>
                                                <button onClick={handleBroadcastTransaction}>Broadcast Transaction</button>
                                        </>
                                )}
                                {broadcastResult && <p>{broadcastResult}</p>}
                        </div>
                </div>
        );
};

export default TestWalletFunctions;