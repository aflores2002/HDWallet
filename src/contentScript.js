// src/contentScript.js
console.log('Content script loaded');

// Notify background script that content script is loaded
chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_LOADED' });

// Inject the Bitcoin provider
const script = document.createElement('script');
script.src = chrome.runtime.getURL('bitcoinProvider.js');
(document.head || document.documentElement).appendChild(script);

function showConfirmationModal(request) {
        return new Promise((resolve) => {
                const modal = document.createElement('div');
                modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

                const modalContent = document.createElement('div');
                modalContent.style.cssText = `
            background-color: white;
            padding: 20px;
            border-radius: 5px;
            max-width: 400px;
        `;

                const message = document.createElement('p');
                message.textContent = request.type === 'signMessage'
                        ? 'Do you want to sign this message?'
                        : 'Do you want to sign this PSBT?';

                const details = document.createElement('pre');
                details.style.cssText = `
            word-wrap: break-word;
            white-space: pre-wrap;
            max-height: 100px;
            overflow-y: auto;
        `;
                details.textContent = request.type === 'signMessage' ? request.message : request.psbtHex;

                const confirmButton = document.createElement('button');
                confirmButton.textContent = 'Confirm';
                confirmButton.style.marginRight = '10px';

                const cancelButton = document.createElement('button');
                cancelButton.textContent = 'Cancel';

                modalContent.appendChild(message);
                modalContent.appendChild(details);
                modalContent.appendChild(confirmButton);
                modalContent.appendChild(cancelButton);
                modal.appendChild(modalContent);

                confirmButton.onclick = () => {
                        document.body.removeChild(modal);
                        console.log('User confirmed');
                        resolve({ confirmed: true });
                };

                cancelButton.onclick = () => {
                        document.body.removeChild(modal);
                        console.log('User cancelled');
                        resolve({ confirmed: false });
                };

                document.body.appendChild(modal);
        });
}

// Function to fetch balance
function fetchBalance(url) {
        return fetch(url)
                .then(response => response.json())
                .catch(error => ({ error: error.toString() }));
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('Content script received message:', request);

        if (request.contentScriptQuery === "fetchBalance") {
                fetchBalance(request.url)
                        .then(data => {
                                console.log('Fetch balance response:', data);
                                sendResponse(data);
                        })
                        .catch(error => {
                                console.error('Error fetching balance:', error);
                                sendResponse({ error: error.toString() });
                        });
                return true;  // Will respond asynchronously
        } else if (request.action === "showConfirmation") {
                showConfirmationModal(request.request).then(result => {
                        console.log('Confirmation result:', result);
                        sendResponse(result);
                });
                return true; // Indicates that we will send a response asynchronously
        }
});

// Handle messages from the page
window.addEventListener("message", function (event) {
        if (event.source != window) return;
        if (event.data.type && event.data.type === "FROM_PAGE") {
                chrome.runtime.sendMessage(event.data, function (response) {
                        window.postMessage({ type: "FROM_EXTENSION", ...response, id: event.data.id }, "*");
                });
        }
});

// Handle messages from the extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "FROM_EXTENSION_BACKGROUND") {
                window.postMessage({ type: "FROM_EXTENSION", ...message }, "*");
        }
});

window.postMessage({ type: 'CONTENT_SCRIPT_LOADED' }, '*');