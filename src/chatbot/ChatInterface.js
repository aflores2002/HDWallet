// src/chatbot/ChatInterface
import React, { useState, useEffect } from 'react';

const ChatInterface = ({ chatManager }) => {
        const [input, setInput] = useState('');
        const [messages, setMessages] = useState([]);
        const [isLoading, setIsLoading] = useState(true);

        useEffect(() => {
                const loadMessages = async () => {
                        await chatManager.loadMessages();
                        setMessages(chatManager.getMessages());
                        setIsLoading(false);
                };
                loadMessages();
        }, [chatManager]);

        const handleSubmit = async (e) => {
                e.preventDefault();
                if (input.trim()) {
                        const newMessage = { text: input, sender: 'user' };
                        await chatManager.addMessage(newMessage);
                        setMessages([...chatManager.getMessages()]);
                        setInput('');

                        const botMessage = { text: `You said: ${input}`, sender: 'bot' };
                        await chatManager.addMessage(botMessage);
                        setMessages([...chatManager.getMessages()]);
                }
        };

        if (isLoading) {
                return <div className="loading">Loading chat...</div>;
        }

        return (
                <div className="chat-container">
                        <div className="chat-box">
                                <div className="chat-messages">
                                        {messages.map((msg, index) => (
                                                <div key={index} className={`message ${msg.sender}`}>
                                                        {msg.text}
                                                </div>
                                        ))}
                                </div>
                                <form onSubmit={handleSubmit} className="chat-input-area">
                                        <input
                                                type="text"
                                                value={input}
                                                onChange={(e) => setInput(e.target.value)}
                                                placeholder="Type your message..."
                                                className="chat-input"
                                        />
                                        <button type="submit" className="chat-send-button">
                                                Send
                                        </button>
                                </form>
                        </div>
                </div>
        );
};

export default ChatInterface;
