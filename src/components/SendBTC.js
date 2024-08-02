// src/components/SendBTC.js
import React, { useState } from 'react';
import { sendBitcoin } from '../services/bitcoinService';

const SendBTC = ({ wallet, onReturn }) => {
        const [recipient, setRecipient] = useState('');
        const [amount, setAmount] = useState('');
        const [error, setError] = useState('');
        const [txid, setTxid] = useState('');

        const handleSend = async (e) => {
                e.preventDefault();
                setError('');
                setTxid('');

                try {
                        if (!wallet || !wallet.wif) {
                                throw new Error('Wallet or WIF is not available');
                        }

                        const txid = await sendBitcoin(wallet.wif, recipient, parseFloat(amount));
                        setTxid(txid);
                } catch (error) {
                        console.error('Send Bitcoin error:', error);
                        setError(error.message);
                }
        };

        return (
                <div className="card">
                        <h2>Send Bitcoin</h2>
                        <form onSubmit={handleSend}>
                                <input
                                        type="text"
                                        value={recipient}
                                        onChange={(e) => setRecipient(e.target.value)}
                                        placeholder="Recipient Address"
                                        required
                                />
                                <input
                                        type="number"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        placeholder="Amount (BTC)"
                                        step="0.00000001"
                                        required
                                />
                                <button type="submit">Send</button>
                        </form>
                        {error && <p className="error">{error}</p>}
                        {txid && <p className="success">Transaction sent! TXID: {txid}</p>}
                        <button onClick={onReturn}>Return</button>
                </div>
        );
};

export default SendBTC;