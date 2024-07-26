import React from 'react';

function CreateWallet({ onCreateWallet }) {
        return (
                <div>
                        <h2>Create a New Wallet</h2>
                        <button onClick={onCreateWallet}>Create Wallet</button>
                </div>
        );
}

export default CreateWallet;