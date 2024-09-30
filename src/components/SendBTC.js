// src/components/SendBTC.js
import React, { useState, useEffect } from 'react';
import { sendBitcoin, confirmAndBroadcastTransaction, validateAddress } from '../services/bitcoinService';

const SendBTC = ({ wallet, onReturn }) => {
        const [recipient, setRecipient] = useState('');
        const [amount, setAmount] = useState('');
        const [feeRate, setFeeRate] = useState('');
        const [error, setError] = useState('');
        const [txid, setTxid] = useState('');
        const [contacts, setContacts] = useState([]);
        const [showContacts, setShowContacts] = useState(false);
        const [pendingTransaction, setPendingTransaction] = useState(null);

        useEffect(() => {
                // Load contacts from storage
                chrome.storage.local.get(['contacts'], (result) => {
                        if (result.contacts) {
                                setContacts(result.contacts);
                        }
                });
        }, []);

        const handleSend = async (e) => {
                e.preventDefault();
                setError('');
                setTxid('');

                try {
                        if (!wallet) {
                                throw new Error('Wallet is not available');
                        }

                        if (!validateAddress(recipient)) {
                                throw new Error('Invalid recipient address');
                        }

                        const amountSatoshis = Math.floor(parseFloat(amount) * 100000000); // Convert BTC to satoshis
                        const result = await sendBitcoin(recipient, amountSatoshis, feeRate ? parseFloat(feeRate) : null);

                        if (result.success) {
                                setPendingTransaction(result);
                        } else {
                                setError(result.error);
                        }
                } catch (error) {
                        console.error('Send Bitcoin error:', error);
                        setError(error.message);
                }
        };

        const handleConfirmTransaction = async () => {
                try {
                        const result = await confirmAndBroadcastTransaction(pendingTransaction.psbt);
                        if (result.success) {
                                setTxid(result.txid);
                                setPendingTransaction(null);
                        } else {
                                setError(result.error);
                        }
                } catch (error) {
                        console.error('Confirm transaction error:', error);
                        setError(error.message);
                }
        };

        const handleCancelTransaction = () => {
                setPendingTransaction(null);
        };

        const handleSelectContact = (contact) => {
                setRecipient(contact.address);
                setShowContacts(false);
        };

        const formatBTC = (satoshis) => {
                return (satoshis / 100000000).toFixed(8);
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
                                <button type="button" onClick={() => setShowContacts(!showContacts)}>
                                        {showContacts ? 'Hide Contacts' : 'Show Contacts'}
                                </button>
                                {showContacts && (
                                        <div className="contacts-list">
                                                {contacts.map((contact, index) => (
                                                        <div key={index} onClick={() => handleSelectContact(contact)}>
                                                                {contact.username}: {contact.address}
                                                        </div>
                                                ))}
                                        </div>
                                )}
                                <input
                                        type="number"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        placeholder="Amount (BTC)"
                                        step="0.00000001"
                                        required
                                />
                                <input
                                        type="number"
                                        value={feeRate}
                                        onChange={(e) => setFeeRate(e.target.value)}
                                        placeholder="Fee Rate (sat/vB, optional)"
                                        step="0.1"
                                />
                                <button type="submit">Prepare Transaction</button>
                        </form>
                        {error && <p className="error">{error}</p>}
                        {txid && <p className="success">Transaction sent! TXID: {txid}</p>}
                        {pendingTransaction && (
                                <div className="transaction-confirmation">
                                        <h3>Confirm Transaction</h3>
                                        <p>To: {recipient}</p>
                                        <p>Amount: {amount} BTC</p>
                                        <p>Fee: {formatBTC(pendingTransaction.fee)} BTC</p>
                                        <p>Fee Rate: {pendingTransaction.feeRate} sat/vB</p>
                                        <button onClick={handleConfirmTransaction}>Confirm</button>
                                        <button onClick={handleCancelTransaction}>Cancel</button>
                                </div>
                        )}
                        <button onClick={onReturn}>Return</button>
                </div>
        );
};

export default SendBTC;