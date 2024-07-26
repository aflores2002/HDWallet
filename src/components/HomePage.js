import React, { useState, useEffect } from 'react';

const HomePage = ({ wallet, onLogout }) => {
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
                        <h2>Bitcoin Wallet</h2>
                        <p>Address: {wallet.address}</p>
                        <p>Balance: {balance} BTC</p>
                        <button onClick={() => console.log('Send Bitcoin')}>Send</button>
                        <button onClick={() => console.log('Receive Bitcoin')}>Receive</button>
                        <button onClick={onLogout}>Logout</button>
                </div>
        );
};

export default HomePage;