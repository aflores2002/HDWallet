// content-script.js
window.addEventListener('message', function (event) {
        // We only accept messages from ourselves
        if (event.source != window) return;

        if (event.data.type && (event.data.type.startsWith('FROM_PAGE_'))) {
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

// Inform the page that the content script has loaded
window.postMessage({ type: 'CONTENT_SCRIPT_LOADED' }, '*');