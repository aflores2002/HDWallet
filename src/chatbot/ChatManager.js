// src/chatbot/ChatManager
class ChatManager {
        constructor() {
                this.messages = [];
        }

        async loadMessages() {
                return new Promise((resolve) => {
                        chrome.storage.local.get(['chatMessages'], (result) => {
                                this.messages = result.chatMessages || [];
                                resolve(this.messages);
                        });
                });
        }

        async addMessage(message) {
                this.messages.push(message);
                return new Promise((resolve) => {
                        chrome.storage.local.set({ chatMessages: this.messages }, () => {
                                resolve();
                        });
                });
        }

        getMessages() {
                return this.messages;
        }
}

export default ChatManager;