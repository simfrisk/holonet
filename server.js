#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const COUCHDB_URL = process.env.COUCHDB_URL;
if (!COUCHDB_URL) {
    console.error('❌ COUCHDB_URL environment variable is required');
    process.exit(1);
}
const DB_NAME = 'osc_contacts';
const API_KEY = process.env.API_KEY || ''; // Optional API key for sync endpoint

// Parse CouchDB credentials from URL
function parseCouchDBUrl(urlString) {
    try {
        const url = new URL(urlString);
        const username = url.username || '';
        const password = url.password || '';
        const baseUrl = `${url.protocol}//${url.host}`;

        // Create Basic Auth header if credentials exist
        const authHeader = username && password
            ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
            : '';

        return { baseUrl, authHeader };
    } catch (error) {
        console.error('Invalid COUCHDB_URL:', error.message);
        return { baseUrl: urlString, authHeader: '' };
    }
}

const { baseUrl: couchBaseUrl, authHeader: couchAuthHeader } = parseCouchDBUrl(COUCHDB_URL);

// Helper function to fetch from CouchDB with auth
async function couchFetch(url, options = {}) {
    const headers = { ...options.headers };
    if (couchAuthHeader) {
        headers['Authorization'] = couchAuthHeader;
    }
    return fetch(url, { ...options, headers });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let dbUrl = '';

// Initialize CouchDB connection
async function initializeCouchDB() {
    try {
        // Build database URL
        dbUrl = `${couchBaseUrl}/${DB_NAME}`;

        // Check if database exists
        const checkResponse = await couchFetch(dbUrl, { method: 'HEAD' });

        if (checkResponse.status === 404) {
            // Create database
            const createResponse = await couchFetch(dbUrl, { method: 'PUT' });
            if (!createResponse.ok) {
                throw new Error('Failed to create database');
            }
            console.log('✅ Created CouchDB database:', DB_NAME);
        } else {
            console.log('✅ Connected to CouchDB database:', DB_NAME);
        }

        // Create design documents for views if needed
        await createDesignDocuments();

    } catch (error) {
        console.error('❌ CouchDB initialization error:', error.message);
        console.log('⚠️  Server will not function without CouchDB');
        process.exit(1);
    }
}

// Create design documents for querying
async function createDesignDocuments() {
    const designDoc = {
        _id: '_design/contacts',
        views: {
            all_contacts: {
                map: function(doc) {
                    if (doc._id !== 'metadata') {
                        emit(doc._id, doc);
                    }
                }.toString()
            },
            by_email: {
                map: function(doc) {
                    if (doc.email) {
                        emit(doc.email, doc);
                    }
                }.toString()
            },
            by_tenant: {
                map: function(doc) {
                    if (doc.tenantName) {
                        emit(doc.tenantName, doc);
                    }
                }.toString()
            }
        }
    };

    try {
        // Check if design doc exists
        const checkUrl = `${dbUrl}/_design/contacts`;
        const checkResponse = await couchFetch(checkUrl);

        if (checkResponse.status === 404) {
            // Create design doc
            const createResponse = await couchFetch(checkUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(designDoc)
            });

            if (createResponse.ok) {
                console.log('✅ Created CouchDB design documents');
            }
        }
    } catch (error) {
        console.warn('⚠️  Could not create design documents:', error.message);
    }
}

// Middleware to verify API key for sync endpoint
function verifyApiKey(req, res, next) {
    if (!API_KEY) {
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
app.get('/api/health', async (req, res) => {
    try {
        const response = await couchFetch(couchBaseUrl);
        const couchStatus = response.ok ? 'connected' : 'disconnected';

        res.json({
            status: 'ok',
            database: couchStatus,
            port: PORT,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            status: 'ok',
            database: 'disconnected',
            port: PORT,
            timestamp: new Date().toISOString()
        });
    }
});

// Get all contacts
app.get('/api/contacts', async (req, res) => {
    try {
        // Get metadata
        const metadataUrl = `${dbUrl}/metadata`;
        const metadataResponse = await couchFetch(metadataUrl);
        const metadata = metadataResponse.ok ? await metadataResponse.json() : null;

        // Get all contacts using view
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_contacts`;
        const viewResponse = await couchFetch(viewUrl);

        if (!viewResponse.ok) {
            throw new Error('Failed to fetch contacts');
        }

        const viewData = await viewResponse.json();
        const contacts = viewData.rows.map(row => {
            const { _id, _rev, ...contact } = row.value;
            return { id: _id, ...contact };
        });

        // Sort by sortOrder if present, then by firstSeen descending (newest first)
        contacts.sort((a, b) => {
            if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
            if (a.sortOrder != null) return -1;
            if (b.sortOrder != null) return 1;
            return new Date(b.firstSeen || 0) - new Date(a.firstSeen || 0);
        });

        res.json({
            metadata: metadata ? {
                totalContacts: contacts.length,
                contacted: metadata.contacted || 0,
                pendingOutreach: metadata.pendingOutreach || contacts.length,
                lastCheckDate: metadata.lastCheckDate || new Date().toISOString()
            } : {
                totalContacts: contacts.length,
                contacted: 0,
                pendingOutreach: contacts.length,
                lastCheckDate: new Date().toISOString()
            },
            contacts
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

        // Get current document
        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        const doc = await getResponse.json();

        // Update document
        doc.notes = notes;
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) {
            throw new Error('Failed to update notes');
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating notes:', error);
        res.status(500).json({ error: 'Failed to update notes' });
    }
});

// Update contact priority
app.patch('/api/contacts/:id/priority', async (req, res) => {
    try {
        const { id } = req.params;
        const { priority } = req.body;

        if (!['high', 'medium', 'low'].includes(priority)) {
            return res.status(400).json({ error: 'priority must be high, medium, or low' });
        }

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        const doc = await getResponse.json();
        doc.priority = priority;
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) {
            throw new Error('Failed to update priority');
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating priority:', error);
        res.status(500).json({ error: 'Failed to update priority' });
    }
});

// Update contact fields (name, email, tenantName, priority, activitySummary, notes)
app.patch('/api/contacts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, tenantName, priority, activitySummary, notes } = req.body;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        const doc = await getResponse.json();

        if (name !== undefined) doc.name = name;
        if (email !== undefined) doc.email = email;
        if (tenantName !== undefined) doc.tenantName = tenantName;
        if (priority !== undefined) doc.priority = priority;
        if (activitySummary !== undefined) doc.activitySummary = activitySummary;
        if (notes !== undefined) doc.notes = notes;
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) {
            throw new Error('Failed to update contact');
        }

        res.json({ success: true, contact: { id, ...doc } });
    } catch (error) {
        console.error('Error updating contact:', error);
        res.status(500).json({ error: 'Failed to update contact' });
    }
});

// Mark contact as contacted (archived)
app.patch('/api/contacts/:id/contacted', async (req, res) => {
    try {
        const { id } = req.params;
        const { contacted } = req.body;

        // Get current document
        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        const doc = await getResponse.json();

        // Update document
        doc.contacted = contacted;
        doc.contactedAt = contacted ? new Date().toISOString() : null;
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) {
            throw new Error('Failed to update contacted status');
        }

        // Update metadata
        await updateMetadataStats();

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating contacted status:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Update metadata statistics
async function updateMetadataStats() {
    try {
        // Get all contacts
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_contacts`;
        const viewResponse = await couchFetch(viewUrl);
        const viewData = await viewResponse.json();

        const contacts = viewData.rows.map(row => row.value);
        const totalContacts = contacts.length;
        const contactedCount = contacts.filter(c => c.contacted).length;

        // Get current metadata
        const metadataUrl = `${dbUrl}/metadata`;
        const metadataResponse = await couchFetch(metadataUrl);
        const metadata = metadataResponse.ok ? await metadataResponse.json() : { _id: 'metadata' };

        // Update metadata
        metadata.contacted = contactedCount;
        metadata.pendingOutreach = totalContacts - contactedCount;
        metadata.lastUpdated = new Date().toISOString();

        await couchFetch(metadataUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata)
        });
    } catch (error) {
        console.warn('Could not update metadata stats:', error.message);
    }
}

// Create a single new contact manually
app.post('/api/contacts', async (req, res) => {
    try {
        const { name, email, tenantName, priority, activitySummary } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }

        const id = `manual-${Date.now()}`;
        const doc = {
            _id: id,
            name,
            email,
            tenantName,
            priority: priority || 'medium',
            activitySummary: activitySummary || 'Manually added contact',
            firstSeen: new Date().toISOString().split('T')[0],
            notes: '',
            contacted: false,
            isNew: true,
            slackChannelId: null,
            createdAt: new Date().toISOString()
        };

        const docUrl = `${dbUrl}/${id}`;
        const response = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!response.ok) {
            throw new Error('Failed to create contact');
        }

        await updateMetadataStats();

        res.json({ success: true, id, contact: { id, ...doc } });
    } catch (error) {
        console.error('Error creating contact:', error);
        res.status(500).json({ error: 'Failed to create contact' });
    }
});

// Sync endpoint - accepts full contact data from Slack agent
app.post('/api/sync', verifyApiKey, async (req, res) => {
    try {
        const { metadata, contacts } = req.body;

        // Validate input
        if (!contacts || !Array.isArray(contacts)) {
            return res.status(400).json({ error: 'Invalid data format: contacts must be an array' });
        }

        console.log(`📥 Syncing ${contacts.length} contacts from Slack agent...`);

        // Get all existing contacts to preserve notes and contacted status
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_contacts`;
        const viewResponse = await couchFetch(viewUrl);
        const existingData = {};

        if (viewResponse.ok) {
            const viewData = await viewResponse.json();
            viewData.rows.forEach(row => {
                const doc = row.value;
                existingData[doc._id] = {
                    notes: doc.notes || '',
                    contacted: doc.contacted || false,
                    contactedAt: doc.contactedAt || null,
                    _rev: doc._rev
                };
            });
        }

        // Prepare bulk update
        const bulkDocs = [];

        // Add metadata
        const metadataUrl = `${dbUrl}/metadata`;
        const metadataResponse = await couchFetch(metadataUrl);
        const existingMetadata = metadataResponse.ok ? await metadataResponse.json() : {};

        bulkDocs.push({
            ...existingMetadata,
            _id: 'metadata',
            ...metadata,
            lastSynced: new Date().toISOString()
        });

        // Add contacts with preserved data
        contacts.forEach(contact => {
            const existing = existingData[contact.id] || {};
            bulkDocs.push({
                _id: contact.id,
                _rev: existing._rev,
                ...contact,
                notes: existing.notes || '',
                contacted: existing.contacted || false,
                contactedAt: existing.contactedAt || null,
                syncedAt: new Date().toISOString()
            });
        });

        // Bulk update to CouchDB
        const bulkUrl = `${dbUrl}/_bulk_docs`;
        const bulkResponse = await couchFetch(bulkUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docs: bulkDocs })
        });

        if (!bulkResponse.ok) {
            throw new Error('Bulk update failed');
        }

        const bulkResult = await bulkResponse.json();
        const errors = bulkResult.filter(r => r.error);

        if (errors.length > 0) {
            console.warn('⚠️  Some updates failed:', errors.length);
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

// Bulk reorder contacts
app.post('/api/contacts/reorder', async (req, res) => {
    try {
        const { order } = req.body; // array of { id, sortOrder }
        if (!Array.isArray(order)) {
            return res.status(400).json({ error: 'order must be an array' });
        }

        // Fetch all docs in parallel, update sortOrder, bulk write
        const docs = await Promise.all(order.map(async ({ id, sortOrder }) => {
            const docUrl = `${dbUrl}/${id}`;
            const getResponse = await couchFetch(docUrl);
            if (!getResponse.ok) return null;
            const doc = await getResponse.json();
            doc.sortOrder = sortOrder;
            doc.updatedAt = new Date().toISOString();
            return doc;
        }));

        const validDocs = docs.filter(Boolean);
        const bulkUrl = `${dbUrl}/_bulk_docs`;
        const bulkResponse = await couchFetch(bulkUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docs: validDocs })
        });

        if (!bulkResponse.ok) {
            throw new Error('Bulk reorder failed');
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error reordering contacts:', error);
        res.status(500).json({ error: 'Failed to reorder contacts' });
    }
});

// Serve HTML files from public directory
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'contact-list.html'));
});

// Start server
async function start() {
    await initializeCouchDB();

    app.listen(PORT, () => {
        console.log(`\n🚀 OSC Contact List Server running!`);
        console.log(`📄 URL: http://localhost:${PORT}/`);
        console.log(`🔧 API: http://localhost:${PORT}/api/contacts`);
        console.log(`💾 CouchDB: ${couchBaseUrl}`);
        console.log(`🔑 API Key: ${API_KEY ? '✅ Enabled' : '⚠️  Disabled (sync endpoint is public)'}\n`);
    });
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

start().catch(console.error);
