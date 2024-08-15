// src/walletUtils.js

export function setCurrentWallet(wallet) {
        return new Promise((resolve, reject) => {
                chrome.storage.local.set({ sessionCurrentWallet: wallet }, () => {
                        if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                        } else {
                                resolve();
                        }
                });
        });
}

export function getCurrentWallet() {
        return new Promise((resolve, reject) => {
                chrome.storage.local.get(['sessionCurrentWallet'], (result) => {
                        if (result.sessionCurrentWallet) {
                                resolve(result.sessionCurrentWallet);
                        } else {
                                reject(new Error("No current wallet available"));
                        }
                });
        });
}