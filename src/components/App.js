import React, { useState, useEffect } from 'react';
import CreateWallet from './CreateWallet';
import HomePage from './HomePage';
import Login from './Login';

const App = () => {
        const [wallet, setWallet] = useState(null);
        const [view, setView] = useState('login');
        const [newWallet, setNewWallet] = useState(null);

        useEffect(() => {
                chrome.storage.local.get(['wallet'], (result) => {
                        if (result.wallet) {
                                setWallet(result.wallet);
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
                setWallet(newWallet);
                setNewWallet(null);
                setView('home');
                chrome.storage.local.set({ wallet: newWallet });
        };

        const handleLogout = () => {
                chrome.storage.local.remove(['wallet'], () => {
                        setWallet(null);
                        setView('login');
                });
        };

        const handleLogin = (mnemonic) => {
                chrome.runtime.sendMessage({ action: 'loginWallet', mnemonic }, (response) => {
                        if (response.success) {
                                setWallet(response.wallet);
                                setView('home');
                        } else {
                                alert('Invalid mnemonic phrase');
                        }
                });
        };

        return (
                <div>
                        {view === 'create' && <CreateWallet onCreateWallet={handleCreateWallet} />}
                        {view === 'showMnemonic' && newWallet && (
                                <div>
                                        <h2>Your New Wallet</h2>
                                        <p>Address: {newWallet.address}</p>
                                        <h3>Mnemonic (Keep this secret!)</h3>
                                        <p>{newWallet.mnemonic}</p>
                                        <button onClick={handleConfirmMnemonic}>I've saved my mnemonic</button>
                                </div>
                        )}
                        {view === 'home' && wallet && <HomePage wallet={wallet} onLogout={handleLogout} />}
                        {view === 'login' && <Login onLogin={handleLogin} />}
                </div>
        );
};

export default App;