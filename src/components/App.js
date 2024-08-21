// src/components/App.js
import React, { useState, useEffect } from 'react';
import CreateWallet from './CreateWallet';
import HomePage from './HomePage';
import Login from './Login';
import SetPassword from './SetPassword';
import SendBTC from './SendBTC';
import ReceivePage from './ReceivePage';
import '../styles.css';

const setCurrentWallet = (wallet) => {
        return new Promise((resolve, reject) => {
                chrome.storage.local.set({ sessionCurrentWallet: wallet }, () => {
                        if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                        } else {
                                resolve();
                        }
                });
        });
};

const getCurrentWallet = () => {
        return new Promise((resolve, reject) => {
                chrome.storage.local.get(['sessionCurrentWallet'], (result) => {
                        if (result.sessionCurrentWallet) {
                                resolve(result.sessionCurrentWallet);
                        } else {
                                reject(new Error("No current wallet available"));
                        }
                });
        });
};

const App = () => {
        const [wallets, setWallets] = useState([]);
        const [currentWallet, setCurrentWallet] = useState(null);
        const [view, setView] = useState('login');
        const [newWallet, setNewWallet] = useState(null);
        const [currentPassword, setCurrentPassword] = useState('');
        const [isLoading, setIsLoading] = useState(true);

        useEffect(() => {
                checkSession();
        }, []);

        const checkSession = async () => {
                setIsLoading(true);
                try {
                        const storedWallet = await getCurrentWallet();
                        if (storedWallet) {
                                setCurrentWallet(storedWallet);
                                setView('home');
                        }
                } catch (error) {
                        console.error('No stored wallet found:', error);
                }
                chrome.runtime.sendMessage({ action: 'getSession' }, (response) => {
                        if (response && response.success) {
                                setWallets(response.wallets || []);
                                setCurrentPassword(response.password || '');
                        }
                        setIsLoading(false);
                });
        };

        const handleCreateWallet = () => {
                chrome.runtime.sendMessage({ action: 'createWallet' }, (response) => {
                        if (chrome.runtime.lastError) {
                                console.error('Error creating wallet:', chrome.runtime.lastError);
                                alert('Error creating wallet. Please try again.');
                                return;
                        }
                        if (response.error) {
                                console.error('Error creating wallet:', response.error);
                                alert('Error creating wallet. Please try again.');
                                return;
                        }
                        console.log('New wallet created:', response);
                        setNewWallet(response);
                        setView('showMnemonic');
                });
        };

        const handleConfirmMnemonic = () => {
                setView('setPassword');
        };

        const handleSetPassword = async (password) => {
                if (!newWallet) {
                        alert('No wallet data available');
                        return;
                }
                console.log('Wallet data being sent for encryption:', newWallet);
                chrome.runtime.sendMessage({
                        action: 'encryptWallet',
                        wallet: newWallet,
                        password: password
                }, async (response) => {
                        console.log('Encryption response:', response);
                        if (response && response.success) {
                                const updatedWallets = [...wallets, response.encryptedWallet];
                                setWallets(updatedWallets);
                                await setCurrentWallet(response.encryptedWallet);
                                setNewWallet(null);
                                setCurrentPassword(password);
                                chrome.runtime.sendMessage({
                                        action: 'setSession',
                                        wallets: updatedWallets,
                                        currentWallet: response.encryptedWallet,
                                        password
                                });
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
                        if (response && response.success && Array.isArray(response.wallets) && response.wallets.length > 0) {
                                setWallets(response.wallets);
                                setCurrentWallet(response.wallets[0]);
                                setCurrentPassword(password);
                                chrome.runtime.sendMessage({
                                        action: 'setSession',
                                        wallets: response.wallets,
                                        currentWallet: response.wallets[0],
                                        password
                                });
                                setView('home');
                        } else {
                                console.error('Login failed:', response ? response.error : 'Unknown error');
                                alert(response && response.error ? response.error : 'Login failed. Please check your password and try again.');
                        }
                });
        };

        const handleLogout = async () => {
                await setCurrentWallet(null);
                chrome.runtime.sendMessage({ action: 'clearSession' }, () => {
                        setWallets([]);
                        setCurrentWallet(null);
                        setCurrentPassword('');
                        setView('login');
                });
        };

        const handleSwitchWallet = async (index) => {
                if (Array.isArray(wallets) && index >= 0 && index < wallets.length) {
                        const newWallet = wallets[index];
                        await setCurrentWallet(newWallet);
                        chrome.runtime.sendMessage({
                                action: 'setSession',
                                wallets: wallets,
                                currentWallet: newWallet,
                                password: currentPassword
                        });
                } else {
                        console.error('Invalid wallet index:', index);
                }
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
                                        const updatedWallets = [...wallets, encryptResponse.encryptedWallet];
                                        setWallets(updatedWallets);
                                        setCurrentWallet(encryptResponse.encryptedWallet);
                                        chrome.runtime.sendMessage({
                                                action: 'setSession',
                                                wallets: updatedWallets,
                                                currentWallet: encryptResponse.encryptedWallet,
                                                password: currentPassword
                                        });
                                } else {
                                        alert(`Failed to create additional wallet: ${encryptResponse ? encryptResponse.error : 'Unknown error'}`);
                                }
                        });
                });
        };

        if (isLoading) {
                return <div>Loading...</div>;
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
                                {view === 'setPassword' && <SetPassword onSetPassword={handleSetPassword} />}
                                {view === 'home' && currentWallet && (
                                        <HomePage
                                                wallet={currentWallet}
                                                wallets={wallets}
                                                onLogout={handleLogout}
                                                onSwitchWallet={handleSwitchWallet}
                                                onCreateWallet={handleCreateAdditionalWallet}
                                                onSend={() => setView('send')}
                                                onReceive={() => setView('receive')}
                                        />
                                )}
                                {view === 'login' && <Login onLogin={handleLogin} onCreateWallet={handleCreateWallet} />}
                                {view === 'send' && currentWallet && <SendBTC wallet={currentWallet} onReturn={() => setView('home')} />}
                                {view === 'receive' && currentWallet && <ReceivePage wallet={currentWallet} onReturn={() => setView('home')} />}
                        </main>
                        <footer className="footer">
                                <p>&copy; 2024 HD Wallet</p>
                        </footer>
                </div>
        );
};

export default App;