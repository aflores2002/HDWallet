import React, { useState } from 'react';

function Login({ onLogin }) {
        const [mnemonic, setMnemonic] = useState('');

        const handleSubmit = (e) => {
                e.preventDefault();
                onLogin(mnemonic);
        };

        return (
                <form onSubmit={handleSubmit}>
                        <h2>Login to Your Wallet</h2>
                        <textarea
                                value={mnemonic}
                                onChange={(e) => setMnemonic(e.target.value)}
                                placeholder="Enter your mnemonic phrase"
                                required
                        />
                        <button type="submit">Login</button>
                </form>
        );
}

export default Login;