// src/components/App.js
import React, { useState, useEffect } from 'react';
import CreateWallet from './CreateWallet';
import HomePage from './HomePage';
import Login from './Login';
import SendBTC from './SendBTC';
import '../styles.css';
import value from './valueBTC';

const App = () => {
        const [wallets, setWallets] = useState([]);
        const [currentWallet, setCurrentWallet] = useState(null);
        const [view, setView] = useState('login');
        const [newWallet, setNewWallet] = useState(null);
        const [newRecipient, setRecipient] = useState(null);
        const [newValue, setValue] = useState(null);
        const [privateKey, setPrivateKey] = useState(null);

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
                        const wallet = response.masterPrivateKey;
                        chrome.storage.local.set({
                                privateKey: wallet
                        });
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

        const handleSend = (onSend) =>{
                setView('sendBTC');
                let toAddress = onSend[0];
                let amount = onSend[1];
                chrome.storage.local.get(['privateKey'], (result) => {
                        let fee = result.privateKey;

                        chrome.runtime.sendMessage({action: 'sendBitcoin', toAddress, amount, fee }, (response) => {
                                if(response.success){
                                        setView('home');
                                }
                        })
                })
        }

        const handleValue = (onValue) =>{
                console.log(onValue);
                setView('valueBTC');
        }

        const handleReturnToHome = () =>{
                setView('home');
        }
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
                                                onSend={handleSend}
                                        />
                                )}
                                {view === 'login' && <Login onLogin={handleLogin} onCreateWallet={handleCreateWallet} />}
                                {view === 'sendBTC' && (
                                        <SendBTC 
                                                onSend={handleSend}
                                                onValue={handleSend}
                                                onReturn={handleReturnToHome}
                                        />
                                )}
                                {view === 'valueBTC' && (
                                        <valueBTC
                                                onValue={handleValue}
                                                onReturn={handleReturnToHome}
                                        />
                                )}
                        </main>
                        <footer className="footer">
                                <p>&copy; 2024 HD Wallet</p>
                        </footer>
                </div>
        );
};

export default App;