// src/contentScript.js
console.log('Content script loaded');

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
                        console.log('User confirmed');  // Debug log
                        resolve({ confirmed: true });
                };

                cancelButton.onclick = () => {
                        document.body.removeChild(modal);
                        console.log('User cancelled');  // Debug log
                        resolve({ confirmed: false });
                };

                document.body.appendChild(modal);
        });
}

window.addEventListener('message', function (event) {
        if (event.source != window) return;

        if (event.data.type && (event.data.type.startsWith('FROM_PAGE_') || event.data.action === 'createPSBT')) {
                console.log('Sending message to extension:', event.data);  // Debug log
                chrome.runtime.sendMessage(event.data)
                        .then(response => {
                                console.log('Received response from extension:', response);  // Debug log
                                window.postMessage({ type: 'FROM_EXTENSION', ...response }, '*');
                        })
                        .catch(error => {
                                console.error('Error in chrome.runtime.sendMessage:', error);
                                window.postMessage({
                                        type: 'FROM_EXTENSION',
                                        action: 'ERROR',
                                        message: error.message || 'An error occurred'
                                }, '*');
                        });
        }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "showConfirmation") {
                console.log('Received showConfirmation request:', message);  // Debug log
                showConfirmationModal(message.request).then(result => {
                        console.log('Confirmation result:', result);  // Debug log
                        sendResponse(result);
                });
                return true; // Indicates that we will send a response asynchronously
        }
});

window.postMessage({ type: 'CONTENT_SCRIPT_LOADED' }, '*');