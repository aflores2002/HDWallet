// src/components/App.js
import React, { useState, useEffect, useCallback } from 'react';
import CreateWallet from './CreateWallet';
import HomePage from './HomePage';
import Login from './Login';

import SetPassword from './SetPassword';

import SendBTC from './SendBTC';

import '../styles.css';

const App = () => {
        const [wallets, setWallets] = useState([]);
        const [currentWallet, setCurrentWallet] = useState(null);
        const [view, setView] = useState('login');
        const [newWallet, setNewWallet] = useState(null);
        const [currentPassword, setCurrentPassword] = useState('');

        // useEffect(() => {
        //         chrome.storage.local.get(['wallets', 'currentWalletIndex'], (result) => {
        //                 if (result.wallets && result.wallets.length > 0) {
        //                         setWallets(result.wallets);
        //                         setCurrentWallet(result.wallets[result.currentWalletIndex || 0]);
        //                         setView('login');
        //                 }
        //         });
        // }, []);

        const handleCreateWallet = () => {
                chrome.runtime.sendMessage({ action: 'createWallet' }, (response) => {
                        if (chrome.runtime.lastError) {
                                console.error('Error creating wallet:', chrome.runtime.lastError);
                                alert('Error creating wallet. Please try again.');
                                return;
                        }
                        setNewWallet(response);
                        setView('showMnemonic');
                });
        };

        const handleConfirmMnemonic = () => {
                setView('setPassword');
        };

        const handleSetPassword = (password) => {
                if (!newWallet) {
                        alert('No wallet data available');
                        return;
                }
                console.log('Setting password for wallet:', newWallet.address);
                chrome.runtime.sendMessage({
                        action: 'encryptWallet',
                        wallet: {
                                mnemonic: newWallet.mnemonic,
                                address: newWallet.address
                        },
                        password: password
                }, (response) => {
                        if (chrome.runtime.lastError) {
                                console.error('Error encrypting wallet:', chrome.runtime.lastError);
                                alert('Error encrypting wallet. Please try again.');
                                return;
                        }
                        console.log('Encrypt wallet response:', response);
                        if (response && response.success) {
                                setWallets([response.encryptedWallet]);
                                setCurrentWallet(response.encryptedWallet);
                                setNewWallet(null);
                                setCurrentPassword(password);
                                setView('home');
                        } else {
                                alert(`Failed to encrypt wallet: ${response ? response.error : 'Unknown error'}`);
                        }
                });
        };


        const handleLogin = (password) => {
                console.log('Attempting login with password');
                chrome.runtime.sendMessage({ action: 'decryptWallets', password }, (response) => {
                        if (chrome.runtime.lastError) {
                                console.error('Error logging in:', chrome.runtime.lastError);
                                alert('Error logging in. Please try again.');
                                return;
                        }
                        console.log('Login response:', response);
                        if (response && response.success) {
                                setWallets(response.wallets);
                                setCurrentWallet(response.wallets[0]);
                                setCurrentPassword(password);
                                setView('home');
                        } else {
                                console.error('Login failed:', response.error);
                                alert(response && response.error ? response.error : 'Login failed. Please check your password and try again.');
                        }
                });
        };

        const handleLogout = () => {
                setWallets([]);
                setCurrentWallet(null);
                setCurrentPassword('');
                setView('login');
        };

        const handleSwitchWallet = (index) => {
                setCurrentWallet(wallets[index]);
        };

        const handleCreateAdditionalWallet = () => {
                chrome.runtime.sendMessage({ action: 'createWallet' }, (response) => {
                        if (chrome.runtime.lastError) {
                                console.error('Error creating additional wallet:', chrome.runtime.lastError);
                                alert('Error creating additional wallet. Please try again.');
                                return;
                        }
                        chrome.runtime.sendMessage({
                                action: 'encryptWallet',
                                wallet: response,
                                password: currentPassword
                        }, (encryptResponse) => {
                                if (chrome.runtime.lastError) {
                                        console.error('Error encrypting additional wallet:', chrome.runtime.lastError);
                                        alert('Error encrypting additional wallet. Please try again.');
                                        return;
                                }
                                if (encryptResponse && encryptResponse.success) {
                                        setWallets([...wallets, encryptResponse.encryptedWallet]);
                                        setCurrentWallet(encryptResponse.encryptedWallet);
                                } else {
                                        alert(`Failed to create additional wallet: ${encryptResponse ? encryptResponse.error : 'Unknown error'}`);
                                }
                        });
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
                                {view === 'setPassword' && <SetPassword onSetPassword={handleSetPassword} />}
                                {view === 'home' && currentWallet && (
                                        <HomePage
                                                wallet={currentWallet}
                                                wallets={wallets}
                                                onLogout={handleLogout}
                                                onSwitchWallet={handleSwitchWallet}
                                                onCreateWallet={handleCreateAdditionalWallet}
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

