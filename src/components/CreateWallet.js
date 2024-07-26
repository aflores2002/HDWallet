import React from 'react';

const CreateWallet = ({ onCreateWallet }) => {
        return (
                <div className="card">
                        <h2>Create a New Wallet</h2>
                        <button className="btn" onClick={onCreateWallet}>Create Wallet</button>
                </div>
        );
};

export default CreateWallet;