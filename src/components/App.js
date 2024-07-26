// src/components/App.js
import React, { useState, useEffect } from 'react';
import CreateWallet from './CreateWallet';
import HomePage from './HomePage';
import Login from './Login';
import '../styles.css';

const App = () => {
        const [wallets, setWallets] = useState([]);
        const [currentWallet, setCurrentWallet] = useState(null);
        const [view, setView] = useState('login');
        const [newWallet, setNewWallet] = useState(null);

        useEffect(() => {
                chrome.storage.local.get(['wallets', 'currentWalletIndex'], (result) => {
                        if (result.wallets && result.wallets.length > 0) {
                                setWallets(result.wallets);
                                setCurrentWallet(result.wallets[result.currentWalletIndex || 0]);
                                setView('home');
                        }
                });
        }, []);

        const handleCreateWallet = () => {
                chrome.runtime.sendMessage({ action: 'createWallet' }, (response) => {
                        setNewWallet(response);
                        setView('showMnemonic');
                });
        };

        const handleConfirmMnemonic = () => {
                const updatedWallets = [...wallets, newWallet];
                setWallets(updatedWallets);
                setCurrentWallet(newWallet);
                setNewWallet(null);
                setView('home');
                chrome.storage.local.set({
                        wallets: updatedWallets,
                        currentWalletIndex: updatedWallets.length - 1
                });
        };

        const handleSwitchWallet = (index) => {
                setCurrentWallet(wallets[index]);
                chrome.storage.local.set({ currentWalletIndex: index });
        };

        const handleLogout = () => {
                chrome.storage.local.remove(['wallets', 'currentWalletIndex'], () => {
                        setWallets([]);
                        setCurrentWallet(null);
                        setView('login');
                });
        };

        const handleLogin = (mnemonic) => {
                chrome.runtime.sendMessage({ action: 'loginWallet', mnemonic }, (response) => {
                        if (response.success) {
                                const updatedWallets = [...wallets, response.wallet];
                                setWallets(updatedWallets);
                                setCurrentWallet(response.wallet);
                                setView('home');
                                chrome.storage.local.set({
                                        wallets: updatedWallets,
                                        currentWalletIndex: updatedWallets.length - 1
                                });
                        } else {
                                alert('Invalid mnemonic phrase');
                        }
                });
        };

        return (
                <div className="container">
                        <header className="header">
                                <h1>HD Wallet</h1>
                        </header>
                        <main className="content">
                                {view === 'create' && <CreateWallet onCreateWallet={handleCreateWallet} />}
                                {view === 'showMnemonic' && newWallet && (
                                        <div className="card">
                                                <h2>Your New Wallet</h2>
                                                <p className="address">Address: {newWallet.address}</p>
                                                <h3>Mnemonic (Keep this secret!)</h3>
                                                <p>{newWallet.mnemonic}</p>
                                                <button className="btn" onClick={handleConfirmMnemonic}>I've saved my mnemonic</button>
                                        </div>
                                )}
                                {view === 'home' && currentWallet && (
                                        <HomePage
                                                wallet={currentWallet}
                                                wallets={wallets}
                                                onLogout={handleLogout}
                                                onSwitchWallet={handleSwitchWallet}
                                                onCreateWallet={handleCreateWallet}
                                        />
                                )}
                                {view === 'login' && <Login onLogin={handleLogin} onCreateWallet={handleCreateWallet} />}
                        </main>
                        <footer className="footer">
                                <p>&copy; 2024 HD Wallet</p>
                        </footer>
                </div>
        );
};

export default App;