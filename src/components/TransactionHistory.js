// src/components/TransactionHistory.js
import React, { useState, useEffect } from 'react';

const TransactionHistory = ({ address, onReturn }) => {
        const [transactions, setTransactions] = useState([]);
        const [isLoading, setIsLoading] = useState(true);

        useEffect(() => {
                const fetchTransactions = async () => {
                        try {
                                const response = await fetch(`https://mempool.space/testnet/api/address/${address}/txs`);
                                const data = await response.json();
                                const processedTxs = await Promise.all(data.map(async (tx) => {
                                        const txDetails = await fetch(`https://mempool.space/testnet/api/tx/${tx.txid}`);
                                        const txData = await txDetails.json();
                                        return {
                                                time: new Date(tx.status.block_time * 1000).toLocaleString(),
                                                txid: tx.txid,
                                                value: txData.vout.reduce((sum, output) => sum + output.value, 0) / 100000000,
                                                confirmed: tx.status.confirmed
                                        };
                                }));
                                setTransactions(processedTxs);
                                setIsLoading(false);
                        } catch (error) {
                                console.error('Error fetching transactions:', error);
                                setIsLoading(false);
                        }
                };

                fetchTransactions();
        }, [address]);

        const truncateText = (text, maxLength) => {
                if (text.length <= maxLength) return text;
                return `${text.substring(0, maxLength)}...`;
        };

        const copyToClipboard = (text) => {
                navigator.clipboard.writeText(text).then(() => {
                        alert('Copied to clipboard!');
                }, (err) => {
                        console.error('Could not copy text: ', err);
                });
        };

        return (
                <div className="card transaction-history">
                        <h2>Transaction History</h2>
                        {isLoading ? (
                                <p>Loading transactions...</p>
                        ) : (
                                <ul className="transaction-list">
                                        {transactions.map((tx) => (
                                                <li key={tx.txid} className="transaction-item">
                                                        <p>Date: {tx.time}</p>
                                                        <p className="txid-container">
                                                                Transaction ID:
                                                                <span className="txid-text">{truncateText(tx.txid, 20)}</span>
                                                                <button
                                                                        className="copy-btn"
                                                                        onClick={() => copyToClipboard(tx.txid)}
                                                                        title="Copy full transaction ID"
                                                                >
                                                                        Copy
                                                                </button>
                                                        </p>
                                                        <p>
                                                                <a
                                                                        href={`https://mempool.space/testnet/tx/${tx.txid}`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="view-tx-btn"
                                                                >
                                                                        View on Mempool
                                                                </a>
                                                        </p>
                                                        <p>Value Sent: {tx.value} BTC</p>
                                                        <p>Confirmed: {tx.confirmed ? 'Yes' : 'No'}</p>
                                                </li>
                                        ))}
                                </ul>
                        )}
                        <button className="btn" onClick={onReturn}>Return</button>
                </div>
        );
};

export default TransactionHistory;