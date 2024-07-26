// src/components/SendBTC.js
import React, { useState } from 'react';

const Send = ({ onSend, onReturn }) => {
        const [recipient, setRecipient] = useState('');

        const handleRecipient = (e) => {
                e.preventDefault();
                onSend(recipient);
        };
        return (
                <div>
                        <form onSubmit={handleRecipient} className="recipient">
                                <h2>Recipient</h2>
                                <textarea
                                        className="input"
                                        value={recipient}
                                        onChange={(e) => setRecipient(e.target.value)}
                                        placeholder="Enter recipient address"
                                        required

                                />
                                <button type="submit" className="btn">Next</button>
                        </form>
                        <button className="btn" onClick={onReturn}>Return</button>
                </div>
        );
};

export default Send;