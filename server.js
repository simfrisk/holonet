#!/usr/bin/env node

const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'osc_contacts';
const API_KEY = process.env.API_KEY || ''; // Optional API key for sync endpoint

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let db;
let contactsCollection;

// Connect to MongoDB
async function connectToMongoDB() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DB_NAME);
        contactsCollection = db.collection('contacts');

        console.log('✅ Connected to MongoDB');

        // Create indexes
        await contactsCollection.createIndex({ email: 1 });
        await contactsCollection.createIndex({ tenantName: 1 });

    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        console.log('⚠️  Server will not function without MongoDB');
        process.exit(1);
    }
}

// Middleware to verify API key for sync endpoint
function verifyApiKey(req, res, next) {
    if (!API_KEY) {
        // No API key configured, allow access
        return next();
    }

    const providedKey = req.headers['x-api-key'] || req.query.apiKey;
    if (providedKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        mongodb: db ? 'connected' : 'disconnected',
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

// Get all contacts
app.get('/api/contacts', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const metadata = await contactsCollection.findOne({ _id: 'metadata' });
        const contacts = await contactsCollection
            .find({ _id: { $ne: 'metadata' } })
            .toArray();

        // Clean up MongoDB _id field from contacts
        const cleanContacts = contacts.map(({ _id, ...contact }) => ({
            id: _id,
            ...contact
        }));

        res.json({
            metadata: metadata || {
                totalContacts: cleanContacts.length,
                contacted: 0,
                pendingOutreach: cleanContacts.length,
                lastCheckDate: new Date().toISOString()
            },
            contacts: cleanContacts
        });
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ error: 'Failed to fetch contacts' });
    }
});

// Update contact notes
app.patch('/api/contacts/:id/notes', async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const result = await contactsCollection.updateOne(
            { _id: id },
            {
                $set: {
                    notes,
                    updatedAt: new Date().toISOString()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating notes:', error);
        res.status(500).json({ error: 'Failed to update notes' });
    }
});

// Mark contact as contacted (archived)
app.patch('/api/contacts/:id/contacted', async (req, res) => {
    try {
        const { id } = req.params;
        const { contacted } = req.body;

        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const result = await contactsCollection.updateOne(
            { _id: id },
            {
                $set: {
                    contacted,
                    contactedAt: contacted ? new Date().toISOString() : null,
                    updatedAt: new Date().toISOString()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        // Update metadata counts
        const totalContacts = await contactsCollection.countDocuments({ _id: { $ne: 'metadata' } });
        const contactedCount = await contactsCollection.countDocuments({
            contacted: true,
            _id: { $ne: 'metadata' }
        });

        await contactsCollection.updateOne(
            { _id: 'metadata' },
            {
                $set: {
                    contacted: contactedCount,
                    pendingOutreach: totalContacts - contactedCount,
                    lastUpdated: new Date().toISOString()
                }
            },
            { upsert: true }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating contacted status:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Sync endpoint - accepts full contact data from Slack agent
app.post('/api/sync', verifyApiKey, async (req, res) => {
    try {
        const { metadata, contacts } = req.body;

        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        // Validate input
        if (!contacts || !Array.isArray(contacts)) {
            return res.status(400).json({ error: 'Invalid data format: contacts must be an array' });
        }

        console.log(`📥 Syncing ${contacts.length} contacts from Slack agent...`);

        // Get existing notes and contacted status before clearing
        const existingContacts = await contactsCollection
            .find({ _id: { $ne: 'metadata' } })
            .toArray();

        const existingData = {};
        existingContacts.forEach(contact => {
            existingData[contact._id] = {
                notes: contact.notes || '',
                contacted: contact.contacted || false,
                contactedAt: contact.contactedAt || null
            };
        });

        // Clear existing data
        await contactsCollection.deleteMany({});

        // Insert metadata
        await contactsCollection.insertOne({
            _id: 'metadata',
            ...metadata,
            lastSynced: new Date().toISOString()
        });

        // Insert contacts, preserving notes and contacted status
        if (contacts.length > 0) {
            const contactsWithPreservedData = contacts.map(contact => {
                const existing = existingData[contact.id] || {};
                return {
                    ...contact,
                    _id: contact.id,
                    notes: existing.notes || '',
                    contacted: existing.contacted || false,
                    contactedAt: existing.contactedAt || null,
                    syncedAt: new Date().toISOString()
                };
            });

            await contactsCollection.insertMany(contactsWithPreservedData);
        }

        console.log(`✅ Synced ${contacts.length} contacts successfully`);

        res.json({
            success: true,
            contactsCount: contacts.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error syncing contacts:', error);
        res.status(500).json({ error: 'Failed to sync contacts', message: error.message });
    }
});

// Serve HTML files from public directory
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'contact-list.html'));
});

// Start server
async function start() {
    await connectToMongoDB();

    app.listen(PORT, () => {
        console.log(`\n🚀 OSC Contact List Server running!`);
        console.log(`📄 URL: http://localhost:${PORT}/`);
        console.log(`🔧 API: http://localhost:${PORT}/api/contacts`);
        console.log(`💾 MongoDB: ${db ? '✅ Connected' : '❌ Disconnected'}`);
        console.log(`🔑 API Key: ${API_KEY ? '✅ Enabled' : '⚠️  Disabled (sync endpoint is public)'}\n`);
    });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    if (db) {
        await db.client.close();
    }
    process.exit(0);
});

start().catch(console.error);
