// src/components/APIKeyInput.js
import React, { useState } from 'react';

const APIKeyInput = ({ onSave }) => {
        const [apiKey, setApiKey] = useState('');

        const handleSubmit = (e) => {
                e.preventDefault();
                chrome.storage.local.set({ openaiApiKey: apiKey }, () => {
                        console.log('API key saved');
                        onSave(apiKey);
                });
        };

        return (
                <form onSubmit={handleSubmit}>
                        <input
                                type="text"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="Enter your OpenAI API key"
                                required
                        />
                        <button type="submit">Save API Key</button>
                </form>
        );
};

export default APIKeyInput;