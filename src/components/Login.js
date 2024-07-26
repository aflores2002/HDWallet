// src/components/Login.js
import React, { useState } from 'react';

const Login = ({ onLogin, onCreateWallet }) => {
        const [mnemonic, setMnemonic] = useState('');

        const handleSubmit = (e) => {
                e.preventDefault();
                onLogin(mnemonic);
        };

        return (
                <div>
                        <form onSubmit={handleSubmit} className="card">
                                <h2>Login to Your Wallet</h2>
                                <textarea
                                        className="input"
                                        value={mnemonic}
                                        onChange={(e) => setMnemonic(e.target.value)}
                                        placeholder="Enter your mnemonic phrase"
                                        required
                                />
                                <button type="submit" className="btn">Login</button>
                        </form>
                        <button className="btn" onClick={onCreateWallet}>Create New Wallet</button>
                </div>
        );
};

export default Login;