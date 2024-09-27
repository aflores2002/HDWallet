// src/chatbot/ChatInterface.js
import React, { useState, useEffect } from 'react';

const ChatInterface = ({ chatManager }) => {
        const [input, setInput] = useState('');
        const [messages, setMessages] = useState([]);
        const [isLoading, setIsLoading] = useState(false);
        const [error, setError] = useState(null);
        const [isFallback, setIsFallback] = useState(false);
        const [pendingTransaction, setPendingTransaction] = useState(null);

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

                                if (parsedResponse.transactionResult && parsedResponse.transactionResult.pendingTransaction) {
                                        setPendingTransaction(parsedResponse.transactionResult.pendingTransaction);
                                }

                                const botMessage = {
                                        text: response,
                                        sender: 'bot',
                                        isFallback: parsedResponse.isFallbackResponse || false,
                                        pendingTransaction: parsedResponse.transactionResult && parsedResponse.transactionResult.pendingTransaction,
                                        requiresConfirmation: parsedResponse.transactionResult && parsedResponse.transactionResult.requiresConfirmation
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

        const handleConfirmTransaction = async (pendingTransaction) => {
                try {
                        const result = await chatManager.confirmAndSendTransaction(pendingTransaction);
                        if (result.success) {
                                const confirmationMessage = {
                                        text: `Transaction confirmed! TXID: ${result.txid}`,
                                        sender: 'bot'
                                };
                                await chatManager.addMessage(confirmationMessage);
                                setMessages([...chatManager.getMessages()]);
                                setPendingTransaction(null);
                        } else {
                                setError(`Failed to confirm transaction: ${result.error}`);
                        }
                } catch (error) {
                        console.error('Error confirming transaction:', error);
                        setError(`Error confirming transaction: ${error.message}`);
                }
        };

        const handleCancelTransaction = () => {
                chatManager.cancelTransaction();
                setPendingTransaction(null);
                const cancelMessage = {
                        text: 'Transaction cancelled.',
                        sender: 'bot'
                };
                chatManager.addMessage(cancelMessage);
                setMessages([...chatManager.getMessages()]);
        };

        return (
                <div className="chat-container">
                        <div className="chat-box">
                                <div className="chat-messages">
                                        {messages.map((msg, index) => (
                                                <div key={index} className={`message ${msg.sender} ${msg.isFallback ? 'fallback' : ''}`}>
                                                        <pre>{msg.text}</pre>
                                                        {msg.isFallback && <span className="fallback-label">Fallback Response</span>}
                                                        {msg.requiresConfirmation && msg.pendingTransaction && (
                                                                <div className="transaction-confirmation">
                                                                        <h3>Confirm Transaction</h3>
                                                                        <p>To: {msg.pendingTransaction.toAddress}</p>
                                                                        <p>Amount: {msg.pendingTransaction.amount} satoshis</p>
                                                                        <p>Fee: {msg.pendingTransaction.feeRate} sat/vB</p>
                                                                        <button onClick={() => handleConfirmTransaction(msg.pendingTransaction)}>Confirm</button>
                                                                        <button onClick={handleCancelTransaction}>Cancel</button>
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
                                                disabled={isLoading || !!pendingTransaction}
                                        />
                                        <button type="submit" className="chat-send-button" disabled={isLoading || !!pendingTransaction}>
                                                {isLoading ? 'Processing...' : 'Send'}
                                        </button>
                                </form>
                        </div>
                </div>
        );
};

export default ChatInterface;