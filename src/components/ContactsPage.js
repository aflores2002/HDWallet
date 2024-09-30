// src/components/ContactsPage.js
import React, { useState, useEffect } from 'react';

const ContactsPage = ({ onReturn }) => {
    const [contacts, setContacts] = useState([]);
    const [newContact, setNewContact] = useState({ username: '', address: '' });

    useEffect(() => {
        // Load contacts from storage when component mounts
        chrome.storage.local.get(['contacts'], (result) => {
            if (result.contacts) {
                setContacts(result.contacts);
            }
        });
    }, []);

    const saveContact = () => {
        if (newContact.username && newContact.address) {
            const updatedContacts = [...contacts, newContact];
            setContacts(updatedContacts);
            chrome.storage.local.set({ contacts: updatedContacts });
            setNewContact({ username: '', address: '' });
        }
    };

    const deleteContact = (index) => {
        const updatedContacts = contacts.filter((_, i) => i !== index);
        setContacts(updatedContacts);
        chrome.storage.local.set({ contacts: updatedContacts });
    };

    return (
        <div className="card">
            <h2>Contacts</h2>
            <div>
                <input
                    type="text"
                    placeholder="Username"
                    value={newContact.username}
                    onChange={(e) => setNewContact({ ...newContact, username: e.target.value })}
                />
                <input
                    type="text"
                    placeholder="Bitcoin Address"
                    value={newContact.address}
                    onChange={(e) => setNewContact({ ...newContact, address: e.target.value })}
                />
                <button onClick={saveContact}>Add Contact</button>
            </div>
            <ul>
                {contacts.map((contact, index) => (
                    <li key={index}>
                        @{contact.username}: {contact.address}
                        <button onClick={() => deleteContact(index)}>Delete</button>
                    </li>
                ))}
            </ul>
            <button onClick={onReturn}>Return</button>
        </div>
    );
};

export default ContactsPage;