// src/components/SetPassword.js
import React, { useState } from 'react';

const SetPassword = ({ onSetPassword }) => {
        const [password, setPassword] = useState('');
        const [confirmPassword, setConfirmPassword] = useState('');
        const [error, setError] = useState('');

        const validatePassword = (pwd) => {
                if (pwd.length < 8) return "Password must be at least 8 characters long";
                if (!/[A-Z]/.test(pwd)) return "Password must contain at least one uppercase letter";
                if (!/[a-z]/.test(pwd)) return "Password must contain at least one lowercase letter";
                if (!/[0-9]/.test(pwd)) return "Password must contain at least one number";
                if (!/[^A-Za-z0-9]/.test(pwd)) return "Password must contain at least one special character";
                return "";
        };

        const handleSubmit = (e) => {
                e.preventDefault();
                setError('');

                const validationError = validatePassword(password);
                if (validationError) {
                        setError(validationError);
                        return;
                }

                if (password !== confirmPassword) {
                        setError("Passwords don't match");
                        return;
                }

                onSetPassword(password);
        };

        return (
                <form onSubmit={handleSubmit} className="card">
                        <h2>Set Login Password</h2>
                        <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter password"
                                required
                                className="input"
                        />
                        <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Confirm password"
                                required
                                className="input"
                        />
                        {error && <p className="error">{error}</p>}
                        <p className="info">
                                Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character.
                        </p>
                        <button type="submit" className="btn">Set Password</button>
                </form>
        );
};

export default SetPassword;