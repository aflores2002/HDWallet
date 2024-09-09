// src/popup.js
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './components/App';
import ErrorBoundary from './components/ErrorBoundary';

let root = null;

const renderApp = () => {
        console.log('Rendering app...');
        const container = document.getElementById('root');
        if (container) {
                if (!root) {
                        root = createRoot(container);
                }
                root.render(
                        <React.StrictMode>
                                <ErrorBoundary>
                                        <App key={Date.now()} />
                                </ErrorBoundary>
                        </React.StrictMode>
                );
        } else {
                console.error('Root element not found');
        }
};

chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'rerender') {
                console.log('Rerender message received');
                renderApp();
        }
});

// Initial render
renderApp();

// Handle popup closing
window.addEventListener('unload', () => {
        if (root) {
                root.unmount();
                root = null;
        }
});