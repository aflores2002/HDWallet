// src/bitcoinProvider.js
(function () {
        class BitcoinProvider {
                constructor() {
                        this.isConnected = false;
                        this.accounts = [];
                        this.listeners = {};
                }

                async request(args) {
                        return new Promise((resolve, reject) => {
                                const id = Math.random().toString(36).substring(7);
                                window.postMessage({ type: "FROM_PAGE", ...args, id }, "*");

                                const handleResponse = (event) => {
                                        if (event.source !== window) return;
                                        if (event.data.type === "FROM_EXTENSION" && event.data.id === id) {
                                                window.removeEventListener("message", handleResponse);
                                                console.log('Received response:', event.data);
                                                if (event.data.error) {
                                                        reject(new Error(event.data.error));
                                                } else if (event.data.success === false) {
                                                        reject(new Error(event.data.error || 'User rejected request'));
                                                } else {
                                                        resolve(event.data);
                                                }
                                        }
                                };

                                window.addEventListener("message", handleResponse);

                                setTimeout(() => {
                                        window.removeEventListener("message", handleResponse);
                                        reject(new Error("Request timed out"));
                                }, 30000);
                        });
                }

                on(eventName, listener) {
                        if (!this.listeners[eventName]) {
                                this.listeners[eventName] = [];
                        }
                        this.listeners[eventName].push(listener);
                }

                emit(eventName, data) {
                        if (this.listeners[eventName]) {
                                this.listeners[eventName].forEach(listener => listener(data));
                        }
                }
        }

        window.bitcoin = new BitcoinProvider();
        window.dispatchEvent(new Event('bitcoinProviderReady'));
})();