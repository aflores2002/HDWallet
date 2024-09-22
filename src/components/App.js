// src/components/App.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import CreateWallet from './CreateWallet';
import HomePage from './HomePage';
import Login from './Login';
import SetPassword from './SetPassword';
import SendBTC from './SendBTC';
import ReceivePage from './ReceivePage';
import '../styles.css';

import { ChatManager, ChatInterface } from '../chatbot';
import APIKeyInput from './APIKeyInput';

const App = () => {
        console.log('App function called');
        const isMountedRef = useRef(true);

        const [bitcoinPrice, setBitcoinPrice] = useState(0);
        const [wallets, setWallets] = useState([]);
        const [currentWallet, setCurrentWallet] = useState(null);
        const [view, setView] = useState('login');
        const [newWallet, setNewWallet] = useState(null);
        const [currentPassword, setCurrentPassword] = useState('');
        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState(null);

        const [isChatLoading, setIsChatLoading] = useState(true);
        const [chatManager, setChatManager] = useState(null);

        const getBalance = useCallback(async () => {
                console.log('getBalance function called');
                console.log('Current wallet:', currentWallet);
                if (currentWallet && currentWallet.address) {
                        console.log(`Fetching balance for address: ${currentWallet.address}`);
                        return new Promise((resolve, reject) => {
                                chrome.runtime.sendMessage({ action: 'getBalance', address: currentWallet.address }, (response) => {
                                        console.log('Balance fetch response:', response);
                                        if (chrome.runtime.lastError) {
                                                console.error('Error fetching balance:', chrome.runtime.lastError);
                                                reject(chrome.runtime.lastError);
                                        } else if (response.success && typeof response.balance === 'number') {
                                                const balanceInSatoshis = Math.floor(response.balance * 100000000);
                                                console.log(`Balance fetched: ${balanceInSatoshis} satoshis`);
                                                resolve(balanceInSatoshis);
                                        } else {
                                                console.error('Failed to fetch balance:', response.error || 'Unknown error');
                                                reject(new Error(response.error || 'Failed to fetch balance'));
                                        }
                                });
                        });
                }
                console.warn('No current wallet available for balance fetch');
                return 0;
        }, [currentWallet]);

        const sendTransaction = useCallback(async (toAddress, amount, feeRate) => {
                return new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage({
                                action: 'sendBitcoin',
                                toAddress: toAddress,
                                amount: amount,
                                feeRate: feeRate
                        }, (response) => {
                                if (chrome.runtime.lastError) {
                                        reject(new Error(chrome.runtime.lastError.message));
                                } else if (response.success) {
                                        resolve({ success: true, txid: response.txid });
                                } else {
                                        resolve({ success: false, error: response.error });
                                }
                        });
                });
        }, []);

        const initializeChatManager = useCallback((apiKey) => {
                if (currentWallet) {
                        console.log('Initializing ChatManager with current wallet:', currentWallet);
                        setChatManager(new ChatManager(apiKey, getBalance, sendTransaction));
                } else {
                        console.warn('Cannot initialize ChatManager: No current wallet available');
                }
        }, [currentWallet, getBalance, sendTransaction]);

        const setCurrentWalletInStorage = useCallback((wallet) => {
                return new Promise((resolve, reject) => {
                        chrome.storage.local.set({ sessionCurrentWallet: wallet }, () => {
                                if (chrome.runtime.lastError) {
                                        reject(new Error(chrome.runtime.lastError.message));
                                } else {
                                        resolve();
                                }
                        });
                });
        }, []);

        const getCurrentWalletFromStorage = useCallback(() => {
                return new Promise((resolve, reject) => {
                        chrome.storage.local.get(['sessionCurrentWallet'], (result) => {
                                if (result.sessionCurrentWallet) {
                                        resolve(result.sessionCurrentWallet);
                                } else {
                                        reject(new Error("No current wallet available"));
                                }
                        });
                });
        }, []);

        const fetchBitcoinPrice = useCallback(async () => {
                try {
                        console.log('Fetching Bitcoin price...');
                        const response = await fetch('https://api.coindesk.com/v1/bpi/currentprice.json');
                        const data = await response.json();
                        setBitcoinPrice(data.bpi.USD.rate_float);
                        console.log('Bitcoin price fetched successfully');
                } catch (error) {
                        console.error('Error fetching Bitcoin price:', error);
                        setError('Failed to fetch Bitcoin price: ' + error.message);
                }
        }, []);

        const checkSession = useCallback(async () => {
                console.log('Checking session...');
                try {
                        const storedWallet = await getCurrentWalletFromStorage();
                        if (storedWallet) {
                                setCurrentWallet(storedWallet);
                                setView('home');
                        }
                } catch (error) {
                        console.error('No stored wallet found:', error);
                }
                return new Promise((resolve) => {
                        chrome.runtime.sendMessage({ action: 'getSession' }, (response) => {
                                console.log('Session response:', response);
                                if (response && response.success) {
                                        setWallets(response.wallets || []);
                                        setCurrentPassword(response.password || '');
                                        if (response.currentWallet) {
                                                setCurrentWallet(response.currentWallet);
                                                setView('home');
                                        }
                                }
                                resolve();
                        });
                });
        }, [getCurrentWalletFromStorage]);

        useEffect(() => {
                console.log('App useEffect triggered');
                const initializeApp = async () => {
                        console.log('Initializing app...');
                        if (!isMountedRef.current) return;
                        setIsLoading(true);
                        setError(null);
                        try {
                                await checkSession();
                                await fetchBitcoinPrice();
                                if (currentWallet) {
                                        chrome.storage.local.get(['openaiApiKey'], (result) => {
                                                if (result.openaiApiKey) {
                                                        initializeChatManager(result.openaiApiKey);
                                                } else {
                                                        console.log('No API key found. User needs to input one.');
                                                }
                                        });
                                }
                                console.log('App initialized successfully');
                        } catch (err) {
                                console.error('Error initializing app:', err);
                                if (isMountedRef.current) setError('Failed to initialize app: ' + err.message);
                        } finally {
                                if (isMountedRef.current) {
                                        setIsLoading(false);
                                        setIsChatLoading(false);
                                }
                        }
                };

                initializeApp();


                const interval = setInterval(fetchBitcoinPrice, 60000); // every minute
                return () => {
                        console.log('App cleanup function called');
                        isMountedRef.current = false;
                        clearInterval(interval);
                };
        }, [fetchBitcoinPrice, checkSession, initializeChatManager, currentWallet]);

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

        console.log('Rendering App component');
        console.log('Current view:', view);
        console.log('Current wallet:', currentWallet);

        // if (isLoading) {
        //         return <div>Loading wallet...</div>;
        // }

        if (error) {
                return <div>Error: {error}</div>;
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
                                {!chatManager && <APIKeyInput onSave={initializeChatManager} />}
                                {chatManager && <ChatInterface chatManager={chatManager} />}
                        </main>
                        <footer className="footer">
                                <p>&copy; 2024 HD Wallet</p>
                        </footer>
                </div>
        );
};

export default App;