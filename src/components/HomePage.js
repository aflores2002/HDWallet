// src/components/HomePage.js
import React, { useState, useEffect } from 'react';

const HomePage = ({ wallet, wallets, onLogout, onSwitchWallet, onCreateWallet, onSend }) => {
        const [balance, setBalance] = useState(null);
        const [isLoading, setIsLoading] = useState(true);

        useEffect(() => {
                if (wallet && wallet.address) {
                        setIsLoading(true);
                        console.log('Fetching balance for address:', wallet.address);
                        chrome.runtime.sendMessage({ action: 'getBalance', address: wallet.address }, (response) => {
                                console.log('Received balance response:', response);
                                setBalance(response);
                                setIsLoading(false);
                        });
                }
        }, [wallet]);

        console.log('Current balance state:', balance);

        if (!wallet) {
                return <div>Loading wallet...</div>;
        }

        return (
                <div>
                        <div className="card">
                                <h2>Your Wallet</h2>
                                <p className="balance">
                                        {isLoading ? 'Loading balance...' :
                                                balance !== null ?
                                                        (typeof balance === 'number' ?
                                                                `${balance.toFixed(8)} BTC` :
                                                                'Invalid balance data') :
                                                        'Error fetching balance'}
                                </p>
                                <p className="address">Address: {wallet.address}</p>
                        </div>
                        <select
                                className="input"
                                value={wallets.findIndex(w => w.address === wallet.address)}
                                onChange={(e) => onSwitchWallet(Number(e.target.value))}
                        >
                                {wallets.map((w, index) => (
                                        <option key={w.address} value={index}>
                                                Wallet {index + 1}
                                        </option>
                                ))}
                        </select>
                        <button className="btn" onClick={onSend}>Send</button>
                        <button className="btn" onClick={() => console.log('Receive Bitcoin')}>Receive</button>
                        <button className="btn" onClick={onCreateWallet}>Create New Wallet</button>
                        <button className="btn" onClick={onLogout}>Logout</button>
                </div>
        );
};

export default HomePage;