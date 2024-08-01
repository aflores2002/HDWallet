// src/components/SendBTC.js
import React, { useState } from 'react';

const Send =({onSend, onValue, onReturn}) =>{
    const[recipient, setRecipient] = useState('');
    const[sendValue, setValue] = useState('');
    
    const handleRecipient = (e) =>{
            e.preventDefault();
            onSend([recipient,sendValue]);        
 
    };
        return(
                <div>
                    <button className="btn" onClick={onReturn}>Return</button>
                    <form id="formContent"onSubmit={handleRecipient} className="card">
                            <h2>Recipient</h2>
                            <textarea
                                className="input"
                                value={recipient}
                                onChange={(e) => setRecipient(e.target.value)}
                                placeholder="Enter recipient address"
                                required
                            
                            />
                            <h2>BitCoin Value</h2>
                            <textarea
                                className="input"
                                value={sendValue}
                                onChange={(e) => setValue(e.target.value)}
                                placeholder="Enter BitCoin Amount to Send"
                                required
                            />
                            <br></br>
                            <button type="submit" className="btn">Next</button>
                    </form>

                </div>
                
        );
};

export default Send;