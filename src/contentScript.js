// content-script.js
console.log('Content script loaded');
window.addEventListener('message', function (event) {
        if (event.source != window) return;

        if (event.data.type && (event.data.type.startsWith('FROM_PAGE_') || event.data.action === 'createPSBT')) {
                chrome.runtime.sendMessage(event.data)
                        .then(response => {
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

window.postMessage({ type: 'CONTENT_SCRIPT_LOADED' }, '*');