// src/components/HomePage.js
import React, { useState, useEffect } from 'react';

const HomePage = ({ wallet, wallets, onLogout, onSwitchWallet, onCreateWallet, onSend }) => {
        const [balance, setBalance] = useState(0);

        useEffect(() => {
                if (wallet && wallet.address) {
                        chrome.runtime.sendMessage({ action: 'getBalance', address: wallet.address }, (response) => {
                                setBalance(response);
                        });
                }
        }, [wallet]);

        if (!wallet) {
                return <div>Loading wallet...</div>;
        }

        return (
                <div>
                        <div className="card">
                                <h2>Your Wallet</h2>
                                <p className="balance">{balance} BTC</p>
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