import React, { useState } from 'react';

const WalletConnect = ({ wallet, onReturn }) => {
        const [message, setMessage] = useState('');
        const [signature, setSignature] = useState('');
        const [psbtHex, setPsbtHex] = useState('');
        const [txid, setTxid] = useState('');

        const handleSignMessage = () => {
                chrome.runtime.sendMessage({
                        action: 'signMessage',
                        message,
                        wif: wallet.wif
                }, response => {
                        setSignature(response.signature);
                });
        };

        const handleSignPsbt = () => {
                // In a real scenario, the PSBT would come from the website
                // Here, we're simulating it with a hex string
                chrome.runtime.sendMessage({
                        action: 'createAndSignPsbt',
                        inputs: [{ address: wallet.address, publicKey: wallet.publicKey }],
                        outputs: [{ address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', value: 1000 }], // Example output
                        wif: wallet.wif
                }, response => {
                        if (response.txid) {
                                setTxid(response.txid);
                        } else {
                                console.error(response.error);
                        }
                });
        };

        return (
                <div className="card">
                        <h2>Wallet Connect</h2>
                        <div>
                                <h3>Sign Message</h3>
                                <input
                                        type="text"
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        placeholder="Enter message to sign"
                                />
                                <button onClick={handleSignMessage}>Sign Message</button>
                                {signature && <p>Signature: {signature}</p>}
                        </div>
                        <div>
                                <h3>Sign PSBT</h3>
                                <button onClick={handleSignPsbt}>Sign and Broadcast PSBT</button>
                                {txid && <p>Transaction ID: {txid}</p>}
                        </div>
                        <button onClick={onReturn}>Return</button>
                </div>
        );
};

export default WalletConnect;