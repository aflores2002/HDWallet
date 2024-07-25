import React, { useState, useEffect } from 'react';

function App() {
        const [wallet, setWallet] = useState(null);

        useEffect(() => {
                chrome.storage.local.get(['wallet'], (result) => {
                        if (result.wallet) {
                                setWallet(result.wallet);
                        }
                });
        }, []);

        const handleCreateWallet = () => {
                chrome.runtime.sendMessage({ action: 'createWallet' }, (response) => {
                        setWallet(response);
                });
        };

        return (
                <div>
                        {wallet ? (
                                <div>
                                        <h2>Your Bitcoin Address</h2>
                                        <p>{wallet.address}</p>
                                        <h3>Mnemonic (Keep this secret!)</h3>
                                        <p>{wallet.mnemonic}</p>
                                </div>
                        ) : (
                                <button onClick={handleCreateWallet}>Create Wallet</button>
                        )}
                </div>
        );
}

export default App;