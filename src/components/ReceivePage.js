// src/components/ReceivePage.js
import React from 'react';

const ReceivePage = ({ wallet, onReturn }) => {
        return (
                <div className="card">
                        <h2>Receive Bitcoin</h2>
                        <p>Your Bitcoin Address:</p>
                        <p className="address">{wallet.address}</p>
                        <button className="btn" onClick={onReturn}>Return</button>
                </div>
        );
};

export default ReceivePage;