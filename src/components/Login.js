// src/components/Login.js
import React, { useState } from 'react';

const Login = ({ onLogin, onCreateWallet }) => {
        const [password, setPassword] = useState('');

        const handleSubmit = (e) => {
                e.preventDefault();
                onLogin(password);
        };

        return (
                <div>
                        <form onSubmit={handleSubmit} className="card">
                                <h2>Login to Your Wallet</h2>
                                <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Enter your password"
                                        required
                                        className="input"
                                />
                                <button type="submit" className="btn">Login</button>
                        </form>
                        <button className="btn" onClick={onCreateWallet}>Create New Wallet</button>
                </div>
        );
};

export default Login;