// src/chatbot/ChatInterface.js
import React, { useState, useEffect } from 'react';

const ChatInterface = ({ chatManager }) => {
        const [input, setInput] = useState('');
        const [messages, setMessages] = useState([]);
        const [isLoading, setIsLoading] = useState(false);
        const [error, setError] = useState(null);
        const [isFallback, setIsFallback] = useState(false);

        useEffect(() => {
                const loadMessages = async () => {
                        await chatManager.loadMessages();
                        setMessages(chatManager.getMessages());
                };
                loadMessages();
        }, [chatManager]);

        const handleSubmit = async (e) => {
                e.preventDefault();
                if (input.trim()) {
                        setIsLoading(true);
                        setError(null);
                        setIsFallback(false);
                        const userMessage = { text: input, sender: 'user' };
                        await chatManager.addMessage(userMessage);
                        setMessages([...chatManager.getMessages()]);
                        setInput('');

                        try {
                                const response = await chatManager.generateBotResponse(input);
                                const parsedResponse = JSON.parse(response);
                                setIsFallback(parsedResponse.isFallbackResponse || false);
                                const botMessage = {
                                        text: response,
                                        sender: 'bot',
                                        isFallback: parsedResponse.isFallbackResponse || false,
                                        transactionResult: parsedResponse.transactionResult
                                };
                                await chatManager.addMessage(botMessage);
                                setMessages([...chatManager.getMessages()]);
                        } catch (error) {
                                console.error('Error in chat:', error);
                                setError(`Failed to generate response: ${error.message}`);
                        } finally {
                                setIsLoading(false);
                        }
                }
        };

        return (
                <div className="chat-container">
                        <div className="chat-box">
                                <div className="chat-messages">
                                        {messages.map((msg, index) => (
                                                <div key={index} className={`message ${msg.sender} ${msg.isFallback ? 'fallback' : ''}`}>
                                                        <pre>{msg.text}</pre>
                                                        {msg.isFallback && <span className="fallback-label">Fallback Response</span>}
                                                        {msg.transactionResult && (
                                                                <div className="transaction-result">
                                                                        {msg.transactionResult.success ? (
                                                                                <span className="success">Transaction successful! TXID: {msg.transactionResult.txid}</span>
                                                                        ) : (
                                                                                <span className="error">Transaction failed: {msg.transactionResult.error}</span>
                                                                        )}
                                                                </div>
                                                        )}
                                                </div>
                                        ))}
                                        {error && <div className="error-message">{error}</div>}
                                        {isFallback && (
                                                <div className="fallback-message">
                                                        Using fallback response due to API unavailability.
                                                </div>
                                        )}
                                </div>
                                <form onSubmit={handleSubmit} className="chat-input-area">
                                        <input
                                                type="text"
                                                value={input}
                                                onChange={(e) => setInput(e.target.value)}
                                                placeholder="Type your message..."
                                                className="chat-input"
                                                disabled={isLoading}
                                        />
                                        <button type="submit" className="chat-send-button" disabled={isLoading}>
                                                {isLoading ? 'Processing...' : 'Send'}
                                        </button>
                                </form>
                        </div>
                </div>
        );
};

export default ChatInterface;