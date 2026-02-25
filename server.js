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

// Valid contact statuses
const VALID_STATUSES = [null, 'contacted', 'later', 'skip'];

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

        // Migrate contacts from old boolean 'contacted' field to new 'status' enum
        await migrateContactStatuses();

        // Migrate todos to ensure they have a listId field (default "default")
        await migrateTodoListIds();

        // Ensure the default todo list document exists
        await ensureDefaultTodoList();

    } catch (error) {
        console.error('❌ CouchDB initialization error:', error.message);
        console.log('⚠️  Server will not function without CouchDB');
        process.exit(1);
    }
}

// Create design documents for querying
async function createDesignDocuments() {
    const checkUrl = `${dbUrl}/_design/contacts`;

    try {
        // Fetch existing design doc (if any)
        const checkResponse = await couchFetch(checkUrl);
        let existingDoc = null;

        if (checkResponse.ok) {
            existingDoc = await checkResponse.json();
            // All required views present — nothing to do
            const required = ['all_contacts', 'by_email', 'by_tenant', 'all_drafts', 'all_todos', 'all_tracked', 'all_todolists'];
            if (existingDoc.views && required.every(v => existingDoc.views[v])) {
                return;
            }
        }

        // Build design doc (preserving _rev if updating)
        const designDoc = {
            _id: '_design/contacts',
            ...(existingDoc ? { _rev: existingDoc._rev } : {}),
            views: {
                all_contacts: {
                    map: function(doc) {
                        if (doc._id !== 'metadata' && doc.type !== 'email_draft' && doc._id !== 'email_topics' && doc.type !== 'todo') {
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
                },
                all_drafts: {
                    map: function(doc) {
                        if (doc.type === 'email_draft') {
                            emit(doc.createdAt, doc);
                        }
                    }.toString()
                },
                all_todos: {
                    map: function(doc) {
                        if (doc.type === 'todo') {
                            emit(doc.sortOrder != null ? doc.sortOrder : doc.createdAt, doc);
                        }
                    }.toString()
                },
                all_tracked: {
                    map: function(doc) {
                        if (doc.type === 'tracked_customer') {
                            emit(doc.addedAt, doc);
                        }
                    }.toString()
                },
                all_todolists: {
                    map: function(doc) {
                        if (doc.type === 'todo_list') {
                            emit(doc.sortOrder != null ? doc.sortOrder : doc.createdAt, doc);
                        }
                    }.toString()
                }
            }
        };

        const saveResponse = await couchFetch(checkUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(designDoc)
        });

        if (saveResponse.ok) {
            console.log(existingDoc ? '✅ Updated CouchDB design documents (added all_drafts view)' : '✅ Created CouchDB design documents');
        } else {
            const err = await saveResponse.text();
            console.warn('⚠️  Could not save design documents:', err);
        }
    } catch (error) {
        console.warn('⚠️  Could not create design documents:', error.message);
    }
}

// Migrate contacts from old boolean 'contacted' field to new 'status' enum
// Migration rule: contacted:true → 'later', contacted:false/undefined → null
async function migrateContactStatuses() {
    try {
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_contacts`;
        const viewResponse = await couchFetch(viewUrl);
        if (!viewResponse.ok) return;

        const viewData = await viewResponse.json();
        const contactsToMigrate = viewData.rows
            .map(row => row.value)
            .filter(doc => doc.status === undefined); // Only migrate contacts without status field

        if (contactsToMigrate.length === 0) {
            console.log('✅ No contacts need status migration');
            return;
        }

        console.log(`🔄 Migrating ${contactsToMigrate.length} contacts to new status system...`);

        const migratedDocs = contactsToMigrate.map(doc => ({
            ...doc,
            status: doc.contacted === true ? 'later' : null,
            contactedAt: doc.contactedAt || (doc.contacted === true ? new Date().toISOString() : null),
            updatedAt: new Date().toISOString()
        }));

        const bulkUrl = `${dbUrl}/_bulk_docs`;
        const bulkResponse = await couchFetch(bulkUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docs: migratedDocs })
        });

        if (bulkResponse.ok) {
            console.log(`✅ Migrated ${contactsToMigrate.length} contacts to new status system`);
        } else {
            console.warn('⚠️  Migration bulk update failed');
        }
    } catch (error) {
        console.warn('⚠️  Could not run status migration:', error.message);
    }
}

// Migrate existing todos to have a listId field defaulting to "default"
async function migrateTodoListIds() {
    try {
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_todos`;
        const viewResponse = await couchFetch(viewUrl);
        if (!viewResponse.ok) return;

        const viewData = await viewResponse.json();
        const todosToMigrate = viewData.rows
            .map(row => row.value)
            .filter(doc => doc.listId === undefined);

        if (todosToMigrate.length === 0) {
            console.log('✅ No todos need listId migration');
            return;
        }

        console.log(`🔄 Migrating ${todosToMigrate.length} todos to add listId field...`);

        const migratedDocs = todosToMigrate.map(doc => ({
            ...doc,
            listId: 'default',
            updatedAt: new Date().toISOString()
        }));

        const bulkUrl = `${dbUrl}/_bulk_docs`;
        const bulkResponse = await couchFetch(bulkUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docs: migratedDocs })
        });

        if (bulkResponse.ok) {
            console.log(`✅ Migrated ${todosToMigrate.length} todos to have listId`);
        } else {
            console.warn('⚠️  Todo listId migration bulk update failed');
        }
    } catch (error) {
        console.warn('⚠️  Could not run todo listId migration:', error.message);
    }
}

// Ensure the default todo list document exists
async function ensureDefaultTodoList() {
    try {
        const docUrl = `${dbUrl}/todolist-default`;
        const getResponse = await couchFetch(docUrl);
        if (getResponse.ok) {
            console.log('✅ Default todo list already exists');
            return;
        }

        const doc = {
            _id: 'todolist-default',
            type: 'todo_list',
            name: 'Default',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sortOrder: 0
        };

        const saveResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (saveResponse.ok) {
            console.log('✅ Created default todo list');
        } else {
            console.warn('⚠️  Could not create default todo list');
        }
    } catch (error) {
        console.warn('⚠️  Could not ensure default todo list:', error.message);
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

        // Calculate live stats from actual contact statuses
        const activeCount = contacts.filter(c => !c.status).length;
        const contactedCount = contacts.filter(c => c.status === 'contacted').length;
        const laterCount = contacts.filter(c => c.status === 'later').length;
        const skipCount = contacts.filter(c => c.status === 'skip').length;
        const focusCount = contacts.filter(c => c.priority === 'focus').length;

        res.json({
            metadata: {
                totalContacts: contacts.length,
                pendingOutreach: activeCount,
                focus: focusCount,
                contacted: contactedCount,
                later: laterCount,
                skip: skipCount,
                lastCheckDate: (metadata && metadata.lastCheckDate) || new Date().toISOString()
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

        if (!['focus', 'high', 'medium', 'low'].includes(priority)) {
            return res.status(400).json({ error: 'priority must be focus, high, medium, or low' });
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

// Update contact status (null=active, 'contacted', 'later', 'skip')
app.patch('/api/contacts/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'status must be null, contacted, later, or skip' });
        }

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        const doc = await getResponse.json();

        doc.status = status;

        // Record when first contacted (keep timestamp for history, don't reset it)
        if (status === 'contacted' && !doc.contactedAt) {
            doc.contactedAt = new Date().toISOString();
        }

        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) {
            throw new Error('Failed to update status');
        }

        res.json({ success: true, status, contactedAt: doc.contactedAt || null });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Legacy endpoint: kept for backward compatibility, maps to /status
app.patch('/api/contacts/:id/contacted', async (req, res) => {
    try {
        const { id } = req.params;
        const { contacted } = req.body;

        // Map old boolean API to new status
        const status = contacted ? 'contacted' : null;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        const doc = await getResponse.json();
        doc.status = status;
        if (status === 'contacted' && !doc.contactedAt) {
            doc.contactedAt = new Date().toISOString();
        }
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) {
            throw new Error('Failed to update status');
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating contacted status:', error);
        res.status(500).json({ error: 'Failed to update status' });
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
            status: null,
            contactedAt: null,
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

        // Get all existing contacts to preserve user-managed fields
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_contacts`;
        const viewResponse = await couchFetch(viewUrl);
        const existingData = {};

        if (viewResponse.ok) {
            const viewData = await viewResponse.json();
            viewData.rows.forEach(row => {
                const doc = row.value;
                existingData[doc._id] = {
                    notes: doc.notes || '',
                    status: doc.status !== undefined ? doc.status : null,
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

        // Add contacts with preserved user-managed data
        contacts.forEach(contact => {
            const existing = existingData[contact.id] || {};

            // Determine status:
            // - If contact has reactivate:true AND existing status is 'contacted' or 'later'
            //   → set to null (back to active). Never reactivate 'skip'.
            // - Otherwise, preserve the existing status from CouchDB
            // - For brand new contacts (no existing), use null (active)
            let finalStatus;
            if (contact.reactivate === true && existing.status !== 'skip') {
                finalStatus = null; // reactivated by Slack bot
            } else if (existing._rev) {
                // Existing contact: always preserve CouchDB status
                finalStatus = existing.status;
            } else {
                // New contact: use null (active) by default
                finalStatus = null;
            }

            // Remove the reactivate flag before storing
            const { reactivate, ...contactData } = contact;

            bulkDocs.push({
                _id: contact.id,
                _rev: existing._rev,
                ...contactData,
                notes: existing.notes || '',
                status: finalStatus,
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

// ================================
// EMAIL DRAFTS API
// ================================

// Get all email drafts
app.get('/api/drafts', async (req, res) => {
    try {
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_drafts`;
        const viewResponse = await couchFetch(viewUrl);

        if (!viewResponse.ok) {
            // View may not exist yet — return empty list gracefully
            return res.json({ drafts: [] });
        }

        const viewData = await viewResponse.json();
        const drafts = viewData.rows.map(row => {
            const { _id, _rev, type, ...draft } = row.value;
            return { id: _id, ...draft };
        });

        // Newest first
        drafts.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        res.json({ drafts });
    } catch (error) {
        console.error('Error fetching drafts:', error);
        res.status(500).json({ error: 'Failed to fetch drafts' });
    }
});

// Create email draft
app.post('/api/drafts', async (req, res) => {
    try {
        const { subject, body, topic } = req.body;

        if (!subject) {
            return res.status(400).json({ error: 'subject is required' });
        }

        const id = `draft-${Date.now()}`;
        const doc = {
            _id: id,
            type: 'email_draft',
            subject,
            body: body || '',
            topic: topic || 'General',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const docUrl = `${dbUrl}/${id}`;
        const response = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!response.ok) throw new Error('Failed to create draft');

        res.json({ success: true, id, draft: { id, ...doc } });
    } catch (error) {
        console.error('Error creating draft:', error);
        res.status(500).json({ error: 'Failed to create draft' });
    }
});

// Update email draft
app.patch('/api/drafts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { subject, body, topic } = req.body;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        const doc = await getResponse.json();

        if (subject !== undefined) doc.subject = subject;
        if (body !== undefined) doc.body = body;
        if (topic !== undefined) doc.topic = topic;
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) throw new Error('Failed to update draft');

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating draft:', error);
        res.status(500).json({ error: 'Failed to update draft' });
    }
});

// Delete email draft
app.delete('/api/drafts/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        const doc = await getResponse.json();
        const deleteResponse = await couchFetch(`${docUrl}?rev=${doc._rev}`, {
            method: 'DELETE'
        });

        if (!deleteResponse.ok) throw new Error('Failed to delete draft');

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting draft:', error);
        res.status(500).json({ error: 'Failed to delete draft' });
    }
});

// ================================
// TOPICS API
// ================================

const DEFAULT_TOPICS = ['Onboarding', 'Re-engagement', 'Feature Announcement', 'Follow-up', 'General'];

// Get all topics
app.get('/api/topics', async (req, res) => {
    try {
        const docUrl = `${dbUrl}/email_topics`;
        const response = await couchFetch(docUrl);

        if (response.status === 404) {
            return res.json({ topics: DEFAULT_TOPICS });
        }

        if (!response.ok) throw new Error('Failed to fetch topics');

        const doc = await response.json();
        res.json({ topics: doc.topics || DEFAULT_TOPICS });
    } catch (error) {
        console.error('Error fetching topics:', error);
        res.status(500).json({ error: 'Failed to fetch topics' });
    }
});

// Delete a topic
app.delete('/api/topics/:topic', async (req, res) => {
    try {
        const topicToDelete = decodeURIComponent(req.params.topic).trim();
        const docUrl = `${dbUrl}/email_topics`;
        const getResponse = await couchFetch(docUrl);

        if (getResponse.status === 404) {
            return res.status(404).json({ error: 'Topics doc not found' });
        }
        if (!getResponse.ok) throw new Error('Failed to fetch topics doc');

        const doc = await getResponse.json();
        const before = (doc.topics || []).length;
        doc.topics = (doc.topics || []).filter(
            t => t.toLowerCase() !== topicToDelete.toLowerCase()
        );

        if (doc.topics.length === before) {
            return res.status(404).json({ error: 'Topic not found' });
        }

        const saveResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!saveResponse.ok) throw new Error('Failed to save topics');

        res.json({ success: true, topics: doc.topics });
    } catch (error) {
        console.error('Error deleting topic:', error);
        res.status(500).json({ error: 'Failed to delete topic' });
    }
});

// Add a topic
app.post('/api/topics', async (req, res) => {
    try {
        const { topic } = req.body;

        if (!topic || !topic.trim()) {
            return res.status(400).json({ error: 'topic is required' });
        }

        const trimmedTopic = topic.trim();
        const docUrl = `${dbUrl}/email_topics`;
        const getResponse = await couchFetch(docUrl);

        let doc;
        if (getResponse.status === 404) {
            doc = { _id: 'email_topics', topics: [...DEFAULT_TOPICS] };
        } else if (getResponse.ok) {
            doc = await getResponse.json();
            if (!doc.topics) doc.topics = [...DEFAULT_TOPICS];
        } else {
            throw new Error('Failed to fetch topics doc');
        }

        // Avoid case-insensitive duplicates
        if (doc.topics.some(t => t.toLowerCase() === trimmedTopic.toLowerCase())) {
            return res.json({ success: true, topics: doc.topics, message: 'Topic already exists' });
        }

        doc.topics.push(trimmedTopic);

        const saveResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!saveResponse.ok) throw new Error('Failed to save topics');

        res.json({ success: true, topics: doc.topics });
    } catch (error) {
        console.error('Error adding topic:', error);
        res.status(500).json({ error: 'Failed to add topic' });
    }
});

// ================================
// TODOS API
// ================================

// Get all todos
app.get('/api/todos', async (req, res) => {
    try {
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_todos`;
        const viewResponse = await couchFetch(viewUrl);

        if (!viewResponse.ok) {
            return res.json({ todos: [] });
        }

        const viewData = await viewResponse.json();
        const todos = viewData.rows.map(row => {
            const { _id, _rev, type, ...todo } = row.value;
            return { id: _id, ...todo };
        });

        // Sort by sortOrder (if set), then by createdAt ascending (oldest first)
        todos.sort((a, b) => {
            if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
            if (a.sortOrder != null) return -1;
            if (b.sortOrder != null) return 1;
            return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        });

        res.json({ todos });
    } catch (error) {
        console.error('Error fetching todos:', error);
        res.status(500).json({ error: 'Failed to fetch todos' });
    }
});

// Create todo
app.post('/api/todos', async (req, res) => {
    try {
        const { text, priority, dueDate, listId } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'text is required' });
        }

        const id = `todo-${Date.now()}`;
        const doc = {
            _id: id,
            type: 'todo',
            text: text.trim(),
            done: false,
            priority: priority || null,
            dueDate: dueDate || null,
            listId: listId || 'todolist-default',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sortOrder: null
        };

        const docUrl = `${dbUrl}/${id}`;
        const response = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!response.ok) throw new Error('Failed to create todo');

        res.json({ success: true, id, todo: { id, ...doc } });
    } catch (error) {
        console.error('Error creating todo:', error);
        res.status(500).json({ error: 'Failed to create todo' });
    }
});

// Update todo (text, done, priority, dueDate, listId, sortOrder)
app.patch('/api/todos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { text, done, priority, dueDate, listId, sortOrder } = req.body;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Todo not found' });
        }

        const doc = await getResponse.json();

        if (text !== undefined) doc.text = text.trim();
        if (done !== undefined) doc.done = Boolean(done);
        if (priority !== undefined) doc.priority = priority;
        if (dueDate !== undefined) doc.dueDate = dueDate;
        if (listId !== undefined) doc.listId = listId;
        if (sortOrder !== undefined) doc.sortOrder = sortOrder;
        if (done === true && !doc.doneAt) doc.doneAt = new Date().toISOString();
        if (done === false) doc.doneAt = null;
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) throw new Error('Failed to update todo');

        res.json({ success: true, todo: { id, ...doc } });
    } catch (error) {
        console.error('Error updating todo:', error);
        res.status(500).json({ error: 'Failed to update todo' });
    }
});

// Delete todo
app.delete('/api/todos/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Todo not found' });
        }

        const doc = await getResponse.json();
        const deleteResponse = await couchFetch(`${docUrl}?rev=${doc._rev}`, {
            method: 'DELETE'
        });

        if (!deleteResponse.ok) throw new Error('Failed to delete todo');

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting todo:', error);
        res.status(500).json({ error: 'Failed to delete todo' });
    }
});

// Reorder todos
app.post('/api/todos/reorder', async (req, res) => {
    try {
        const { order } = req.body; // [{ id, sortOrder }, ...]
        if (!Array.isArray(order)) {
            return res.status(400).json({ error: 'order must be an array' });
        }

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

        if (!bulkResponse.ok) throw new Error('Bulk reorder failed');

        res.json({ success: true });
    } catch (error) {
        console.error('Error reordering todos:', error);
        res.status(500).json({ error: 'Failed to reorder todos' });
    }
});

// ================================
// TODO LISTS API
// ================================

// Get all todo lists
app.get('/api/todolists', async (req, res) => {
    try {
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_todolists`;
        const viewResponse = await couchFetch(viewUrl);

        if (!viewResponse.ok) {
            return res.json({ lists: [] });
        }

        const viewData = await viewResponse.json();
        const lists = viewData.rows.map(row => {
            const { _id, _rev, type, ...list } = row.value;
            return { id: _id, ...list };
        });

        lists.sort((a, b) => {
            if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
            if (a.sortOrder != null) return -1;
            if (b.sortOrder != null) return 1;
            return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        });

        res.json({ lists });
    } catch (error) {
        console.error('Error fetching todo lists:', error);
        res.status(500).json({ error: 'Failed to fetch todo lists' });
    }
});

// Create todo list
app.post('/api/todolists', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        const id = `todolist-${Date.now()}`;
        const doc = {
            _id: id,
            type: 'todo_list',
            name: name.trim(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sortOrder: null
        };

        const docUrl = `${dbUrl}/${id}`;
        const response = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!response.ok) throw new Error('Failed to create todo list');

        res.json({ success: true, id, list: { id, ...doc } });
    } catch (error) {
        console.error('Error creating todo list:', error);
        res.status(500).json({ error: 'Failed to create todo list' });
    }
});

// Update todo list (rename)
app.patch('/api/todolists/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, sortOrder } = req.body;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Todo list not found' });
        }

        const doc = await getResponse.json();
        if (name !== undefined) doc.name = name.trim();
        if (sortOrder !== undefined) doc.sortOrder = sortOrder;
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) throw new Error('Failed to update todo list');

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating todo list:', error);
        res.status(500).json({ error: 'Failed to update todo list' });
    }
});

// Delete todo list (moves its todos to "default")
app.delete('/api/todolists/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (id === 'todolist-default') {
            return res.status(400).json({ error: 'Cannot delete the default list' });
        }

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Todo list not found' });
        }

        const doc = await getResponse.json();

        // Move todos in this list to "default"
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_todos`;
        const viewResponse = await couchFetch(viewUrl);
        if (viewResponse.ok) {
            const viewData = await viewResponse.json();
            const todosInList = viewData.rows
                .map(row => row.value)
                .filter(t => t.listId === id);

            if (todosInList.length > 0) {
                const updatedTodos = todosInList.map(t => ({ ...t, listId: 'todolist-default', updatedAt: new Date().toISOString() }));
                await couchFetch(`${dbUrl}/_bulk_docs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ docs: updatedTodos })
                });
            }
        }

        const deleteResponse = await couchFetch(`${docUrl}?rev=${doc._rev}`, { method: 'DELETE' });
        if (!deleteResponse.ok) throw new Error('Failed to delete todo list');

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting todo list:', error);
        res.status(500).json({ error: 'Failed to delete todo list' });
    }
});

// Reorder todo lists
app.post('/api/todolists/reorder', async (req, res) => {
    try {
        const { order } = req.body; // [{ id, sortOrder }, ...]
        if (!Array.isArray(order)) {
            return res.status(400).json({ error: 'order must be an array' });
        }

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

        if (!bulkResponse.ok) throw new Error('Bulk reorder failed');

        res.json({ success: true });
    } catch (error) {
        console.error('Error reordering todo lists:', error);
        res.status(500).json({ error: 'Failed to reorder todo lists' });
    }
});

// ================================
// TRACKED CUSTOMERS API
// ================================

// Get all tracked customers
app.get('/api/tracked', async (req, res) => {
    try {
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_tracked`;
        const viewResponse = await couchFetch(viewUrl);

        if (!viewResponse.ok) {
            return res.json({ tracked: [] });
        }

        const viewData = await viewResponse.json();
        const tracked = viewData.rows.map(row => {
            const { _id, _rev, type, ...item } = row.value;
            return { id: _id, ...item };
        });

        // Sort by cardOrder (if set), fall back to addedAt ascending
        tracked.sort((a, b) => {
            if (a.cardOrder != null && b.cardOrder != null) return a.cardOrder - b.cardOrder;
            if (a.cardOrder != null) return -1;
            if (b.cardOrder != null) return 1;
            return new Date(a.addedAt || 0) - new Date(b.addedAt || 0);
        });

        res.json({ tracked });
    } catch (error) {
        console.error('Error fetching tracked customers:', error);
        res.status(500).json({ error: 'Failed to fetch tracked customers' });
    }
});

// Create tracked customer (optionally from a contact)
app.post('/api/tracked', async (req, res) => {
    try {
        const { contactId, name, organization, tenantName, email, health, stage, notes, nextFollowUp } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }

        const id = `tracked-${Date.now()}`;
        const doc = {
            _id: id,
            type: 'tracked_customer',
            contactId: contactId || null,
            name,
            organization: organization || null,
            tenantName: tenantName || null,
            email: email || null,
            health: health || 'unknown',
            stage: stage || 'Onboarding',
            notes: notes || '',
            nextFollowUp: nextFollowUp || null,
            touchpoints: [],
            addedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const docUrl = `${dbUrl}/${id}`;
        const response = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!response.ok) throw new Error('Failed to create tracked customer');

        res.json({ success: true, id, tracked: { id, ...doc } });
    } catch (error) {
        console.error('Error creating tracked customer:', error);
        res.status(500).json({ error: 'Failed to create tracked customer' });
    }
});

// Update tracked customer (health, stage, notes, nextFollowUp)
app.patch('/api/tracked/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, organization, tenantName, email, health, stage, notes, nextFollowUp } = req.body;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Tracked customer not found' });
        }

        const doc = await getResponse.json();

        if (name !== undefined) doc.name = name;
        if (organization !== undefined) doc.organization = organization;
        if (tenantName !== undefined) doc.tenantName = tenantName;
        if (email !== undefined) doc.email = email;
        if (health !== undefined) doc.health = health;
        if (stage !== undefined) doc.stage = stage;
        if (notes !== undefined) doc.notes = notes;
        if (nextFollowUp !== undefined) doc.nextFollowUp = nextFollowUp;
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) throw new Error('Failed to update tracked customer');

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating tracked customer:', error);
        res.status(500).json({ error: 'Failed to update tracked customer' });
    }
});

// Bulk reorder tracked customers
app.post('/api/tracked/reorder', async (req, res) => {
    try {
        const { order } = req.body; // [{ id, cardOrder }, ...]
        if (!Array.isArray(order)) {
            return res.status(400).json({ error: 'order must be an array' });
        }

        const docs = await Promise.all(order.map(async ({ id, cardOrder }) => {
            const docUrl = `${dbUrl}/${id}`;
            const getResponse = await couchFetch(docUrl);
            if (!getResponse.ok) return null;
            const doc = await getResponse.json();
            doc.cardOrder = cardOrder;
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

        if (!bulkResponse.ok) throw new Error('Bulk reorder failed');

        res.json({ success: true });
    } catch (error) {
        console.error('Error reordering tracked customers:', error);
        res.status(500).json({ error: 'Failed to reorder tracked customers' });
    }
});

// Delete tracked customer
app.delete('/api/tracked/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Tracked customer not found' });
        }

        const doc = await getResponse.json();
        const deleteResponse = await couchFetch(`${docUrl}?rev=${doc._rev}`, { method: 'DELETE' });

        if (!deleteResponse.ok) throw new Error('Failed to delete tracked customer');

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting tracked customer:', error);
        res.status(500).json({ error: 'Failed to delete tracked customer' });
    }
});

// Add a touchpoint to a tracked customer
app.post('/api/tracked/:id/touchpoints', async (req, res) => {
    try {
        const { id } = req.params;
        const { date, type, note } = req.body;

        if (!note) {
            return res.status(400).json({ error: 'note is required' });
        }

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Tracked customer not found' });
        }

        const doc = await getResponse.json();

        const touchpoint = {
            id: `tp-${Date.now()}`,
            date: date || new Date().toISOString().split('T')[0],
            type: type || 'other',
            note
        };

        doc.touchpoints = doc.touchpoints || [];
        doc.touchpoints.unshift(touchpoint); // newest first
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) throw new Error('Failed to add touchpoint');

        res.json({ success: true, touchpoint });
    } catch (error) {
        console.error('Error adding touchpoint:', error);
        res.status(500).json({ error: 'Failed to add touchpoint' });
    }
});

// Delete a touchpoint
app.delete('/api/tracked/:id/touchpoints/:tpId', async (req, res) => {
    try {
        const { id, tpId } = req.params;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Tracked customer not found' });
        }

        const doc = await getResponse.json();
        const before = (doc.touchpoints || []).length;
        doc.touchpoints = (doc.touchpoints || []).filter(tp => tp.id !== tpId);

        if (doc.touchpoints.length === before) {
            return res.status(404).json({ error: 'Touchpoint not found' });
        }

        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) throw new Error('Failed to delete touchpoint');

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting touchpoint:', error);
        res.status(500).json({ error: 'Failed to delete touchpoint' });
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
