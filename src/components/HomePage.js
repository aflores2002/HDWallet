import React, { useState, useEffect } from 'react';
import TransactionHistory from './TransactionHistory';

const HomePage = ({ wallet, wallets, onLogout, onSwitchWallet, onCreateWallet, onSend, onReceive }) => {
        const [balance, setBalance] = useState(null);
        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState(null);
        const [showTransactionHistory, setShowTransactionHistory] = useState(false);

        useEffect(() => {
                if (wallet && wallet.address) {
                        fetchBalance(wallet.address);
                }
        }, [wallet]);

        const fetchBalance = (address) => {
                setIsLoading(true);
                setError(null);
                chrome.runtime.sendMessage({ action: 'getBalance', address }, (response) => {
                        console.log('Balance response:', response);
                        if (chrome.runtime.lastError) {
                                console.error('Error fetching balance:', chrome.runtime.lastError);
                                setError('Failed to fetch balance');
                        } else if (response.success && typeof response.balance === 'number') {
                                setBalance(response.balance);
                        } else {
                                setError(response.error || 'Failed to fetch balance');
                        }
                        setIsLoading(false);
                });
        };

        const formatBalance = (balance) => {
                if (balance === null || balance === undefined) return 'Error fetching balance';
                if (typeof balance !== 'number') return 'Invalid balance data';
                return balance.toFixed(8) + ' BTC';
        };

        console.log('Current balance state:', balance);

        if (!wallet) {
                return <div>Loading wallet...</div>;
        }

        if (showTransactionHistory) {
                return <TransactionHistory address={wallet.address} onReturn={() => setShowTransactionHistory(false)} />;
        }

        return (
                <div>
                        <div className="card">
                                <h2>Your Wallet</h2>
                                <p className="balance">
                                        {isLoading ? 'Loading balance...' :
                                                error ? `Error: ${error}` :
                                                        `Balance: ${formatBalance(balance)}`}
                                </p>
                                <button className="btn" onClick={() => fetchBalance(wallet.address)}>Refresh Balance</button>
                        </div>
                        <select
                                className="input"
                                value={Array.isArray(wallets) ? wallets.findIndex(w => w.address === wallet.address) : -1}
                                onChange={(e) => onSwitchWallet(Number(e.target.value))}
                        >
                                {Array.isArray(wallets) && wallets.map((w, index) => (
                                        <option key={w.address} value={index}>
                                                Wallet {index + 1}
                                        </option>
                                ))}
                        </select>
                        <button className="btn" onClick={onSend}>Send</button>
                        <button className="btn" onClick={onReceive}>Receive</button>
                        <button className="btn" onClick={() => setShowTransactionHistory(true)}>View Transaction History</button>
                        <button className="btn" onClick={onCreateWallet}>Create New Wallet</button>
                        <button className="btn" onClick={onLogout}>Logout</button>
                </div>
        );
};

export default HomePage;