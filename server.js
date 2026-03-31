#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;
const COUCHDB_URL = process.env.COUCHDB_URL;
if (!COUCHDB_URL) {
    console.error('❌ COUCHDB_URL environment variable is required');
    process.exit(1);
}
const DB_NAME = 'osc_contacts';
const API_KEY = process.env.API_KEY || ''; // Optional API key for sync endpoint
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || ''; // If set, enables login protection
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
    console.error('❌ SESSION_SECRET environment variable is required');
    process.exit(1);
}

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

// =========================================
// AUTH (cookie-based, no extra dependencies)
// =========================================

function parseCookies(req) {
    const raw = req.headers.cookie || '';
    return Object.fromEntries(
        raw.split(';')
            .map(c => c.trim())
            .filter(Boolean)
            .map(c => {
                const idx = c.indexOf('=');
                return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1).trim())];
            })
    );
}

function generateAuthToken() {
    return crypto.createHmac('sha256', SESSION_SECRET).update(LOGIN_PASSWORD).digest('hex');
}

function isAuthenticated(req) {
    if (!LOGIN_PASSWORD) return true; // no password configured = open access
    const cookies = parseCookies(req);
    return cookies['auth_token'] === generateAuthToken();
}

function requireAuth(req, res, next) {
    if (isAuthenticated(req)) return next();
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/login.html');
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Auth gate: runs before static files so HTML pages are also protected
app.use((req, res, next) => {
    const exempt = ['/login.html', '/api/login', '/api/health'];
    if (exempt.includes(req.path)) return next();
    // Video API endpoints use their own dual auth (API key OR cookie)
    if (req.path.startsWith('/api/videos')) return next();
    return requireAuth(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public')));

// Login endpoint
app.post('/api/login', (req, res) => {
    if (!LOGIN_PASSWORD) {
        return res.json({ success: true }); // no password = always succeed
    }
    const { password } = req.body || {};
    if (password === LOGIN_PASSWORD) {
        const token = generateAuthToken();
        const maxAge = 60 * 60 * 24 * 30; // 30 days
        res.setHeader('Set-Cookie', `auth_token=${token}; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=${maxAge}`);
        return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Wrong password' });
});

// Logout endpoint
app.get('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'auth_token=; HttpOnly; Secure; Path=/; Max-Age=0');
    res.redirect('/login.html');
});

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

        // Migrate tracked customers from inFocus boolean to category string
        await migrateTrackedCategory();

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
            const required = ['all_contacts', 'by_email', 'by_tenant', 'all_drafts', 'all_todos', 'all_tracked', 'all_todolists', 'all_briefs', 'all_brief_items', 'all_videos'];
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
                all_videos: {
                    map: function(doc) {
                        if (doc.type === 'video') {
                            emit(doc.createdAt, doc);
                        }
                    }.toString()
                },
                all_todolists: {
                    map: function(doc) {
                        if (doc.type === 'todo_list') {
                            emit(doc.sortOrder != null ? doc.sortOrder : doc.createdAt, doc);
                        }
                    }.toString()
                },
                all_briefs: {
                    map: function(doc) {
                        if (doc.type === 'daily_brief') {
                            emit(doc.date, doc);
                        }
                    }.toString()
                },
                all_brief_items: {
                    map: function(doc) {
                        if (doc.type === 'brief_item') {
                            emit([doc.briefId, doc.sortOrder != null ? doc.sortOrder : 9999], doc);
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

// Migrate tracked customers from old inFocus boolean to new category string field
// Migration rules:
//   inFocus === true  → category: 'focus', remove inFocus
//   inFocus === false/undefined → category: null, remove inFocus
async function migrateTrackedCategory() {
    try {
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_tracked`;
        const viewResponse = await couchFetch(viewUrl);
        if (!viewResponse.ok) return;

        const viewData = await viewResponse.json();
        // Migrate docs that still have the old inFocus field OR have no category field at all
        const toMigrate = viewData.rows
            .map(row => row.value)
            .filter(doc => doc.category === undefined);

        if (toMigrate.length === 0) {
            console.log('✅ No tracked customers need category migration');
            return;
        }

        console.log(`🔄 Migrating ${toMigrate.length} tracked customers to category field...`);

        const migratedDocs = toMigrate.map(doc => {
            const { inFocus, ...rest } = doc;
            return {
                ...rest,
                category: inFocus === true ? 'focus' : null,
                updatedAt: new Date().toISOString()
            };
        });

        const bulkUrl = `${dbUrl}/_bulk_docs`;
        const bulkResponse = await couchFetch(bulkUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docs: migratedDocs })
        });

        if (bulkResponse.ok) {
            console.log(`✅ Migrated ${toMigrate.length} tracked customers to category field`);
        } else {
            console.warn('⚠️  Category migration bulk update failed');
        }
    } catch (error) {
        console.warn('⚠️  Could not run category migration:', error.message);
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

// Update contact fields (name, email, tenantName, priority, activitySummary, notes, company, role, industry, linkedIn, tags, status)
app.patch('/api/contacts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, tenantName, priority, activitySummary, notes, company, role, industry, linkedIn, tags, status } = req.body;

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
        if (company !== undefined) doc.company = company;
        if (role !== undefined) doc.role = role;
        if (industry !== undefined) doc.industry = industry;
        if (linkedIn !== undefined) doc.linkedIn = linkedIn;
        if (tags !== undefined) doc.tags = tags;
        if (status !== undefined) {
            doc.status = status;
            if (status === 'contacted' && !doc.contactedAt) {
                doc.contactedAt = new Date().toISOString();
            }
        }
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) {
            throw new Error('Failed to update contact');
        }

        const { _id, _rev, ...contactData } = doc;
        res.json({ success: true, contact: { id, ...contactData } });
    } catch (error) {
        console.error('Error updating contact:', error);
        res.status(500).json({ error: 'Failed to update contact' });
    }
});

// Add contact history entry
app.post('/api/contacts/:id/history', requireAuth, async (req, res) => {
    try {
        const docUrl = `${dbUrl}/${req.params.id}`;
        const getResponse = await couchFetch(docUrl);
        if (!getResponse.ok) return res.status(404).json({ error: 'Not found' });
        const doc = await getResponse.json();
        const { date, method, summary, source } = req.body;
        if (!summary) return res.status(400).json({ error: 'summary is required' });
        const entry = {
            id: `history-${Date.now()}`,
            date: date || new Date().toISOString().slice(0, 10),
            method: method || 'other',
            summary,
            source: source || 'manual',
            createdAt: new Date().toISOString()
        };
        if (!doc.contactHistory) doc.contactHistory = [];
        doc.contactHistory.push(entry);
        doc.updatedAt = new Date().toISOString();
        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });
        if (!updateResponse.ok) throw new Error('Failed to save history entry');
        const { _id, _rev, ...contactData } = doc;
        res.json({ id: _id, ...contactData });
    } catch (err) {
        console.error('Error adding history entry:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete contact history entry
app.delete('/api/contacts/:id/history/:historyId', requireAuth, async (req, res) => {
    try {
        const docUrl = `${dbUrl}/${req.params.id}`;
        const getResponse = await couchFetch(docUrl);
        if (!getResponse.ok) return res.status(404).json({ error: 'Not found' });
        const doc = await getResponse.json();
        doc.contactHistory = (doc.contactHistory || []).filter(e => e.id !== req.params.historyId);
        doc.updatedAt = new Date().toISOString();
        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });
        if (!updateResponse.ok) throw new Error('Failed to delete history entry');
        const { _id, _rev, ...contactData } = doc;
        res.json({ id: _id, ...contactData });
    } catch (err) {
        console.error('Error deleting history entry:', err);
        res.status(500).json({ error: err.message });
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
// Accepts API key OR cookie auth
app.post('/api/sync', async (req, res) => {
    const apiKeyValid = !API_KEY || (req.headers['x-api-key'] === API_KEY || req.query.apiKey === API_KEY);
    const cookieAuth = isAuthenticated(req);
    if (!apiKeyValid && !cookieAuth) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

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
                    company: doc.company,
                    role: doc.role,
                    industry: doc.industry,
                    linkedIn: doc.linkedIn,
                    tags: doc.tags,
                    contactHistory: doc.contactHistory,
                    source: doc.source,
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

            // Preserve profile fields: never overwrite with sync data
            const profileFields = {};
            if (existing.company !== undefined) profileFields.company = existing.company;
            if (existing.role !== undefined) profileFields.role = existing.role;
            if (existing.industry !== undefined) profileFields.industry = existing.industry;
            if (existing.linkedIn !== undefined) profileFields.linkedIn = existing.linkedIn;
            if (existing.tags !== undefined) profileFields.tags = existing.tags;
            if (existing.contactHistory !== undefined) profileFields.contactHistory = existing.contactHistory;
            // Preserve source if already set; otherwise use incoming source if provided
            if (existing.source) {
                profileFields.source = existing.source;
            } else if (contactData.source) {
                profileFields.source = contactData.source;
            }

            bulkDocs.push({
                _id: contact.id,
                _rev: existing._rev,
                ...contactData,
                ...profileFields,
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

// Delete a contact
app.delete('/api/contacts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);
        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        const doc = await getResponse.json();
        const deleteResponse = await couchFetch(`${docUrl}?rev=${doc._rev}`, { method: 'DELETE' });
        if (!deleteResponse.ok) throw new Error('Failed to delete contact');
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting contact:', error);
        res.status(500).json({ error: 'Failed to delete contact' });
    }
});

// Search contacts by name, email, or tenantName (case-insensitive)
// GET /api/contacts/search?q=<query>
app.get('/api/contacts/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim().toLowerCase();
        if (!q) {
            return res.json({ contacts: [] });
        }

        const viewUrl = `${dbUrl}/_design/contacts/_view/all_contacts`;
        const viewResponse = await couchFetch(viewUrl);
        if (!viewResponse.ok) {
            throw new Error('Failed to fetch contacts');
        }

        const viewData = await viewResponse.json();
        const contacts = viewData.rows
            .map(row => {
                const { _id, _rev, ...contact } = row.value;
                return { id: _id, ...contact };
            })
            .filter(c =>
                (c.name || '').toLowerCase().includes(q) ||
                (c.email || '').toLowerCase().includes(q) ||
                (c.tenantName || '').toLowerCase().includes(q) ||
                (c.company || '').toLowerCase().includes(q) ||
                (c.role || '').toLowerCase().includes(q) ||
                (c.industry || '').toLowerCase().includes(q) ||
                ((c.tags || []).join(' ')).toLowerCase().includes(q)
            );

        res.json({ contacts });
    } catch (error) {
        console.error('Error searching contacts:', error);
        res.status(500).json({ error: 'Failed to search contacts' });
    }
});

// Get contacts with overdue or today follow-up (status != 'skip')
// GET /api/contacts/due-followup
app.get('/api/contacts/due-followup', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        const viewUrl = `${dbUrl}/_design/contacts/_view/all_contacts`;
        const viewResponse = await couchFetch(viewUrl);
        if (!viewResponse.ok) {
            throw new Error('Failed to fetch contacts');
        }

        const viewData = await viewResponse.json();
        const contacts = viewData.rows
            .map(row => {
                const { _id, _rev, ...contact } = row.value;
                return { id: _id, ...contact };
            })
            .filter(c =>
                c.nextFollowUp &&
                c.nextFollowUp <= today &&
                c.status !== 'skip'
            );

        // Sort most overdue first (earliest date first)
        contacts.sort((a, b) => (a.nextFollowUp || '').localeCompare(b.nextFollowUp || ''));

        res.json({ contacts });
    } catch (error) {
        console.error('Error fetching due follow-ups:', error);
        res.status(500).json({ error: 'Failed to fetch due follow-ups' });
    }
});

// Bulk status update
// POST /api/contacts/bulk-status  { ids: string[], status: string }
app.post('/api/contacts/bulk-status', async (req, res) => {
    try {
        const { ids, status } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids must be a non-empty array' });
        }
        if (!VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'status must be null, contacted, later, or skip' });
        }

        const now = new Date().toISOString();

        const docs = await Promise.all(ids.map(async (id) => {
            const docUrl = `${dbUrl}/${id}`;
            const getResponse = await couchFetch(docUrl);
            if (!getResponse.ok) return null;
            const doc = await getResponse.json();
            doc.status = status;
            if (status === 'contacted' && !doc.contactedAt) {
                doc.contactedAt = now;
            }
            doc.updatedAt = now;
            return doc;
        }));

        const validDocs = docs.filter(Boolean);
        if (validDocs.length === 0) {
            return res.json({ success: true, updated: 0 });
        }

        const bulkResponse = await couchFetch(`${dbUrl}/_bulk_docs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docs: validDocs })
        });

        if (!bulkResponse.ok) throw new Error('Bulk status update failed');

        res.json({ success: true, updated: validDocs.length });
    } catch (error) {
        console.error('Error bulk updating status:', error);
        res.status(500).json({ error: 'Failed to bulk update status' });
    }
});

// Bulk delete contacts
app.post('/api/contacts/bulk-delete', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids must be a non-empty array' });
        }
        await bulkDeleteDocs(ids);
        res.json({ success: true, deleted: ids.length });
    } catch (error) {
        console.error('Error bulk deleting contacts:', error);
        res.status(500).json({ error: 'Failed to bulk delete contacts' });
    }
});

// Bulk reorder contacts
app.post('/api/contacts/reorder', async (req, res) => {
    try {
        const { order } = req.body; // array of { id, sortOrder }
        if (!Array.isArray(order)) {
            return res.status(400).json({ error: 'order must be an array' });
        }
        await bulkReorderDocs(order, 'sortOrder');
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

        // Sort by sortOrder if present, then newest first
        drafts.sort((a, b) => {
            if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
            if (a.sortOrder != null) return -1;
            if (b.sortOrder != null) return 1;
            return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        });

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

// Reorder email drafts
app.post('/api/drafts/reorder', async (req, res) => {
    try {
        const { order } = req.body; // [{ id, sortOrder }, ...]
        if (!Array.isArray(order)) {
            return res.status(400).json({ error: 'order must be an array' });
        }
        await bulkReorderDocs(order, 'sortOrder');
        res.json({ success: true });
    } catch (error) {
        console.error('Error reordering drafts:', error);
        res.status(500).json({ error: 'Failed to reorder drafts' });
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
        const { text, done, priority, dueDate, listId, sortOrder, content } = req.body;

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
        if (content !== undefined) doc.content = content;
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
        await bulkReorderDocs(order, 'sortOrder');
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
        await bulkReorderDocs(order, 'sortOrder');
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

        // Sort: focus first, then paying, then trial, then unassigned — each group by cardOrder
        const categoryOrder = { 'focus': 0, 'paying': 1, 'trial': 2, null: 3, undefined: 3 };
        tracked.sort((a, b) => {
            const aRank = categoryOrder[a.category] ?? 3;
            const bRank = categoryOrder[b.category] ?? 3;
            if (aRank !== bRank) return aRank - bRank;
            // Same category: sort by cardOrder, fall back to addedAt
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
        const { contactId, name, organization, tenantName, email, health, stage, notes, nextFollowUp, customFields, todos } = req.body;

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
            customFields: customFields || [],
            todos: todos || [],
            touchpoints: [],
            category: null,
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
        const { name, organization, tenantName, email, health, stage, notes, nextFollowUp, customFields, todos } = req.body;

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
        if (customFields !== undefined) doc.customFields = customFields;
        if (todos !== undefined) doc.todos = todos;
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

// Set category on a tracked customer
// Body: { category: 'focus' | 'paying' | 'trial' | null }
const VALID_TRACKED_CATEGORIES = ['focus', 'paying', 'trial', null];

app.patch('/api/tracked/:id/category', async (req, res) => {
    try {
        const { id } = req.params;
        const { category } = req.body;

        if (!VALID_TRACKED_CATEGORIES.includes(category)) {
            return res.status(400).json({ error: 'category must be focus, paying, trial, or null' });
        }

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Tracked customer not found' });
        }

        const doc = await getResponse.json();
        doc.category = category;
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) throw new Error('Failed to update category');

        res.json({ success: true, category });
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({ error: 'Failed to update category' });
    }
});

// Legacy alias: PATCH /api/tracked/:id/focus → maps to category endpoint
app.patch('/api/tracked/:id/focus', async (req, res) => {
    try {
        const { id } = req.params;
        const { inFocus } = req.body;

        if (typeof inFocus !== 'boolean') {
            return res.status(400).json({ error: 'inFocus must be a boolean' });
        }

        const category = inFocus ? 'focus' : null;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Tracked customer not found' });
        }

        const doc = await getResponse.json();
        doc.category = category;
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) throw new Error('Failed to update category');

        res.json({ success: true, inFocus, category });
    } catch (error) {
        console.error('Error updating focus (legacy):', error);
        res.status(500).json({ error: 'Failed to update focus' });
    }
});

// Bulk reorder tracked customers
app.post('/api/tracked/reorder', async (req, res) => {
    try {
        const { order } = req.body; // [{ id, cardOrder }, ...]
        if (!Array.isArray(order)) {
            return res.status(400).json({ error: 'order must be an array' });
        }
        await bulkReorderDocs(order, 'cardOrder');
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
        const { date, type, note, description } = req.body;

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
            note,
            description: description || null
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

// Update a touchpoint
app.patch('/api/tracked/:id/touchpoints/:tpId', async (req, res) => {
    try {
        const { id, tpId } = req.params;
        const { type, date, note, description } = req.body;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);
        if (!getResponse.ok) return res.status(404).json({ error: 'Tracked customer not found' });

        const doc = await getResponse.json();
        const tpIdx = (doc.touchpoints || []).findIndex(tp => tp.id === tpId);
        if (tpIdx === -1) return res.status(404).json({ error: 'Touchpoint not found' });

        const existing = doc.touchpoints[tpIdx];
        doc.touchpoints[tpIdx] = {
            ...existing,
            ...(type !== undefined && { type }),
            ...(date !== undefined && { date }),
            ...(note !== undefined && { note }),
            ...(description !== undefined && { description }),
        };
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });
        if (!updateResponse.ok) throw new Error('Failed to update touchpoint');

        res.json({ touchpoint: doc.touchpoints[tpIdx] });
    } catch (error) {
        console.error('Error updating touchpoint:', error);
        res.status(500).json({ error: 'Failed to update touchpoint' });
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

// === OSC MONITOR ROUTES ===
// Proxy routes for Grafana/Loki/Prometheus data.
// All routes are protected by the global requireAuth middleware already applied above.

const MONITOR_GRAFANA_URL = process.env.GRAFANA_URL || 'https://ops-ui.osaas.io';
const MONITOR_GRAFANA_TOKEN = process.env.GRAFANA_TOKEN || '';
const MONITOR_LOKI_UID = process.env.LOKI_UID || 'ce673d8c-9728-44c7-8c78-8c10df447caa';
const MONITOR_PROM_UID = process.env.PROM_UID || 'dbc6c44d-10b7-4ba1-b18a-af74de200791';

const MONITOR_LOKI_BASE = `${MONITOR_GRAFANA_URL}/api/datasources/proxy/uid/${MONITOR_LOKI_UID}/loki/api/v1`;
const MONITOR_PROM_BASE = `${MONITOR_GRAFANA_URL}/api/datasources/proxy/uid/${MONITOR_PROM_UID}/api/v1`;

function monitorAuthHeaders() {
    return {
        Authorization: `Bearer ${MONITOR_GRAFANA_TOKEN}`,
        'Content-Type': 'application/json',
    };
}

// Query Loki query_range endpoint. Returns array of stream objects.
async function grafanaLoki(query, from, to, limit = 200, direction = 'backward') {
    const params = new URLSearchParams({
        query,
        start: String(from),
        end: String(to),
        limit: String(limit),
        direction,
    });
    const url = `${MONITOR_LOKI_BASE}/query_range?${params}`;
    try {
        const res = await fetch(url, { headers: monitorAuthHeaders() });
        if (!res.ok) {
            console.error(`Loki query failed: ${res.status} ${res.statusText}`);
            return [];
        }
        const data = await res.json();
        if (data.status !== 'success') return [];
        return data.data.result;
    } catch (err) {
        console.error('Loki query error:', err.message);
        return [];
    }
}

// Query Prometheus query_range endpoint. Returns array of result objects.
async function grafanaPrometheus(expr, start, end, step) {
    const params = new URLSearchParams({
        query: expr,
        start: String(start),
        end: String(end),
        step: String(step),
    });
    const url = `${MONITOR_PROM_BASE}/query_range?${params}`;
    try {
        const res = await fetch(url, { headers: monitorAuthHeaders() });
        if (!res.ok) {
            console.error(`Prometheus range query failed: ${res.status} ${res.statusText}`);
            return [];
        }
        const data = await res.json();
        if (data.status !== 'success') return [];
        return data.data.result;
    } catch (err) {
        console.error('Prometheus range query error:', err.message);
        return [];
    }
}

// Query Prometheus instant query endpoint. Returns array of result objects.
async function grafanaPrometheusInstant(expr) {
    const params = new URLSearchParams({ query: expr });
    const url = `${MONITOR_PROM_BASE}/query?${params}`;
    try {
        const res = await fetch(url, { headers: monitorAuthHeaders() });
        if (!res.ok) {
            console.error(`Prometheus query failed: ${res.status} ${res.statusText}`);
            return [];
        }
        const data = await res.json();
        if (data.status !== 'success') return [];
        return data.data.result;
    } catch (err) {
        console.error('Prometheus query error:', err.message);
        return [];
    }
}

function monitorNowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function monitorRangeSeconds(rangeLabel) {
    const map = {
        '1h': 3600,
        '6h': 21600,
        '12h': 43200,
        '24h': 86400,
        '48h': 172800,
        '7d': 604800,
    };
    return map[rangeLabel] || 21600;
}

function monitorStepForRange(rangeSecs) {
    if (rangeSecs <= 3600) return 60;
    if (rangeSecs <= 21600) return 300;
    if (rangeSecs <= 86400) return 600;
    if (rangeSecs <= 172800) return 1200;
    return 3600;
}

// ---- Event parsing helpers ----

function monitorMakeId(ts, tenant, type) {
    return `${ts}-${tenant}-${type}`;
}

function parseGUIAuditLine(ts, line) {
    const customerMatch = line.match(/customer=(\S+)/);
    const actionMatch = line.match(/action (\S+) on resource (\S+)/);

    if (!customerMatch || !actionMatch) return null;

    const tenant = customerMatch[1];
    const action = actionMatch[1];
    const resource = actionMatch[2].replace(/"+$/, '');
    const timestamp = Math.floor(parseInt(ts, 10) / 1_000_000); // nanoseconds to ms

    switch (action) {
        case 'create:instance': {
            const parts = resource.split('/');
            const service = parts[0];
            const instanceName = parts[1] || resource;
            return {
                id: monitorMakeId(ts, tenant, 'create_instance'),
                type: 'instance_created',
                emoji: '🚀',
                tenant,
                description: `${tenant} created instance ${instanceName} (${service})`,
                timestamp,
            };
        }
        case 'delete:instance': {
            const parts = resource.split('/');
            const service = parts[0];
            const instanceName = parts[1] || resource;
            return {
                id: monitorMakeId(ts, tenant, 'delete_instance'),
                type: 'instance_removed',
                emoji: '🗑️',
                tenant,
                description: `${tenant} removed instance ${instanceName} (${service})`,
                timestamp,
            };
        }
        case 'restart:instance': {
            const parts = resource.split('/');
            const instanceName = parts[1] || resource;
            return {
                id: monitorMakeId(ts, tenant, 'restart_instance'),
                type: 'instance_restarted',
                emoji: '🔄',
                tenant,
                description: `${tenant} restarted instance ${instanceName}`,
                timestamp,
            };
        }
        case 'create:tenant':
            return {
                id: monitorMakeId(ts, tenant, 'create_tenant'),
                type: 'tenant_signup',
                emoji: '👤',
                tenant,
                description: `New tenant signed up: ${tenant}`,
                timestamp,
            };
        case 'deploy:solution':
            return {
                id: monitorMakeId(ts, tenant, 'deploy_solution'),
                type: 'solution_deployed',
                emoji: '🔧',
                tenant,
                description: `${tenant} deployed solution ${resource}`,
                timestamp,
            };
        case 'delete:solution':
            return {
                id: monitorMakeId(ts, tenant, 'delete_solution'),
                type: 'solution_destroyed',
                emoji: '💣',
                tenant,
                description: `${tenant} destroyed solution ${resource}`,
                timestamp,
            };
        default:
            return null;
    }
}

const MCP_WRITE_ACTIONS = new Set([
    'create-database',
    'create-service-instance',
    'delete-service-instance',
    'restart-service-instance',
    'create-my-app',
    'delete-my-app',
    'restart-my-app',
    'deploy-solution',
    'remove-deployed-solution',
]);

function parseMCPAuditLine(ts, line) {
    const msgIdx = line.indexOf('msg="');
    if (msgIdx === -1) return null;

    try {
        const raw = line.slice(msgIdx + 5, -1); // strip 'msg="' and trailing '"'
        const jsonStr = raw.replace(/\\"/g, '"');
        const data = JSON.parse(jsonStr);

        if (!data.action || !MCP_WRITE_ACTIONS.has(data.action) || !data.success) return null;

        const tenant = data.tenantId || 'unknown';
        const resource = data.resource || '';
        const timestamp = Math.floor(parseInt(ts, 10) / 1_000_000);

        switch (data.action) {
            case 'create-database':
                return {
                    id: monitorMakeId(ts, tenant, 'mcp_create_db'),
                    type: 'instance_created',
                    emoji: '🚀',
                    tenant,
                    description: `${tenant} created database ${resource}${data.type ? ` (${data.type})` : ''} 🤖`,
                    timestamp,
                };
            case 'create-service-instance':
                return {
                    id: monitorMakeId(ts, tenant, 'mcp_create_instance'),
                    type: 'instance_created',
                    emoji: '🚀',
                    tenant,
                    description: `${tenant} created instance ${resource} 🤖`,
                    timestamp,
                };
            case 'delete-service-instance':
                return {
                    id: monitorMakeId(ts, tenant, 'mcp_delete_instance'),
                    type: 'instance_removed',
                    emoji: '🗑️',
                    tenant,
                    description: `${tenant} removed instance ${resource} 🤖`,
                    timestamp,
                };
            case 'restart-service-instance':
                return {
                    id: monitorMakeId(ts, tenant, 'mcp_restart_instance'),
                    type: 'instance_restarted',
                    emoji: '🔄',
                    tenant,
                    description: `${tenant} restarted instance ${resource} 🤖`,
                    timestamp,
                };
            case 'create-my-app':
                return {
                    id: monitorMakeId(ts, tenant, 'mcp_create_app'),
                    type: 'instance_created',
                    emoji: '🚀',
                    tenant,
                    description: `${tenant} created app ${resource} 🤖`,
                    timestamp,
                };
            case 'delete-my-app':
                return {
                    id: monitorMakeId(ts, tenant, 'mcp_delete_app'),
                    type: 'instance_removed',
                    emoji: '🗑️',
                    tenant,
                    description: `${tenant} deleted app ${resource} 🤖`,
                    timestamp,
                };
            case 'restart-my-app':
                return {
                    id: monitorMakeId(ts, tenant, 'mcp_restart_app'),
                    type: 'instance_restarted',
                    emoji: '🔄',
                    tenant,
                    description: `${tenant} restarted app ${resource} 🤖`,
                    timestamp,
                };
            case 'deploy-solution':
                return {
                    id: monitorMakeId(ts, tenant, 'mcp_deploy_solution'),
                    type: 'solution_deployed',
                    emoji: '🔧',
                    tenant,
                    description: `${tenant} deployed solution ${resource} 🤖`,
                    timestamp,
                };
            case 'remove-deployed-solution':
                return {
                    id: monitorMakeId(ts, tenant, 'mcp_remove_solution'),
                    type: 'solution_destroyed',
                    emoji: '💣',
                    tenant,
                    description: `${tenant} destroyed solution ${resource} 🤖`,
                    timestamp,
                };
            default:
                return null;
        }
    } catch {
        return null;
    }
}

async function fetchGUIEvents(sinceMs, nowMs) {
    const streams = await grafanaLoki(
        '{job="gui/ui"} |= "audit"',
        Math.floor(sinceMs / 1000),
        Math.floor(nowMs / 1000),
        200
    );
    const events = [];
    for (const stream of streams) {
        for (const [ts, line] of stream.values) {
            const event = parseGUIAuditLine(ts, line);
            if (event) events.push(event);
        }
    }
    return events;
}

async function fetchSignupEvents(sinceMs, nowMs) {
    const streams = await grafanaLoki(
        '{namespace="osaas"} |~ "create-team" |~ "magic-link"',
        Math.floor(sinceMs / 1000),
        Math.floor(nowMs / 1000),
        50
    );
    const seen = new Set();
    const events = [];
    for (const stream of streams) {
        for (const [ts, line] of stream.values) {
            const emailMatch = line.match(/email=([^&\s"]+)/);
            const email = emailMatch ? decodeURIComponent(emailMatch[1]) : undefined;
            if (email && !seen.has(email)) {
                seen.add(email);
                const timestamp = Math.floor(parseInt(ts, 10) / 1_000_000);
                events.push({
                    id: monitorMakeId(ts, email, 'signup'),
                    type: 'tenant_signup',
                    emoji: '👤',
                    tenant: email,
                    description: `New signup: ${email}`,
                    timestamp,
                });
            }
        }
    }
    return events;
}

async function fetchMCPEvents(sinceMs, nowMs) {
    const streams = await grafanaLoki(
        '{job="osaas/ai-manager"} |= "level=info" |~ "create|delete|restart|deploy|remove"',
        Math.floor(sinceMs / 1000),
        Math.floor(nowMs / 1000),
        200
    );
    const events = [];
    for (const stream of streams) {
        for (const [ts, line] of stream.values) {
            const event = parseMCPAuditLine(ts, line);
            if (event) events.push(event);
        }
    }
    return events;
}

async function fetchPlanChangeEvents(sinceMs, nowMs) {
    const streams = await grafanaLoki(
        '{job="osaas/money-manager"} |= "POST" |= "/tenantplan"',
        Math.floor(sinceMs / 1000),
        Math.floor(nowMs / 1000),
        50
    );
    const events = [];
    for (const stream of streams) {
        for (const [ts, line] of stream.values) {
            const timestamp = Math.floor(parseInt(ts, 10) / 1_000_000);
            const idMatch = line.match(/id=(\S+)/);
            const requestId = idMatch ? idMatch[1] : ts;
            events.push({
                id: monitorMakeId(ts, requestId, 'plan_change'),
                type: 'plan_upgrade',
                emoji: '⬆️',
                tenant: 'unknown',
                description: 'Tenant updated plan',
                timestamp,
            });
        }
    }
    return events;
}

function mergeAndDedupEvents(guiEvents, signupEvents, planEvents, mcpEvents) {
    const guiSignups = new Set(
        guiEvents.filter(e => e.type === 'tenant_signup').map(e => e.tenant)
    );
    const filteredSignups = signupEvents.filter(e => !guiSignups.has(e.tenant));

    const all = [...guiEvents, ...filteredSignups, ...planEvents, ...mcpEvents];
    all.sort((a, b) => b.timestamp - a.timestamp);

    const seen = new Set();
    return all.filter(e => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
    });
}

// GET /api/monitor/events
// Params: since (ISO timestamp), before (ISO timestamp), page (int, default 0)
app.get('/api/monitor/events', async (req, res) => {
    if (!MONITOR_GRAFANA_TOKEN) {
        return res.status(503).json({ error: 'Monitoring not configured' });
    }

    const { since: sinceParam, before: beforeParam } = req.query;
    const now = Date.now();

    // Live-poll mode: fetch events newer than `since`
    if (sinceParam) {
        const since = new Date(sinceParam).getTime();
        try {
            const [guiEvents, signupEvents, planEvents, mcpEvents] = await Promise.all([
                fetchGUIEvents(since, now),
                fetchSignupEvents(since, now),
                fetchPlanChangeEvents(since, now),
                fetchMCPEvents(since, now),
            ]);
            const allEvents = mergeAndDedupEvents(guiEvents, signupEvents, planEvents, mcpEvents);
            const latestTimestamp = allEvents.length > 0
                ? new Date(allEvents[0].timestamp).toISOString()
                : sinceParam;
            return res.json({ events: allEvents, count: allEvents.length, latestTimestamp, hasMore: false });
        } catch (err) {
            console.error('Events fetch error:', err);
            return res.status(500).json({ events: [], count: 0, error: String(err) });
        }
    }

    // Paginated mode: fetch one 3-day chunk
    const CHUNK_MS = 3 * 86400 * 1000;
    const MAX_HISTORY_MS = 30 * 86400 * 1000;
    const before = beforeParam ? new Date(beforeParam).getTime() : now;
    const since = before - CHUNK_MS;
    const oldest = now - MAX_HISTORY_MS;
    const hasMore = since > oldest;

    try {
        const [guiEvents, signupEvents, planEvents, mcpEvents] = await Promise.all([
            fetchGUIEvents(since, before),
            fetchSignupEvents(since, before),
            fetchPlanChangeEvents(since, before),
            fetchMCPEvents(since, before),
        ]);

        const allEvents = mergeAndDedupEvents(guiEvents, signupEvents, planEvents, mcpEvents);

        const latestTimestamp = allEvents.length > 0
            ? new Date(allEvents[0].timestamp).toISOString()
            : new Date(before).toISOString();

        const oldestTimestamp = allEvents.length > 0
            ? new Date(allEvents[allEvents.length - 1].timestamp).toISOString()
            : new Date(since).toISOString();

        return res.json({
            events: allEvents,
            count: allEvents.length,
            latestTimestamp,
            oldestTimestamp,
            hasMore,
        });
    } catch (err) {
        console.error('Events fetch error:', err);
        return res.status(500).json({ events: [], count: 0, error: String(err) });
    }
});

// GET /api/monitor/instances/current
// Returns top 30 tenants by pod count with their service lists.
app.get('/api/monitor/instances/current', async (req, res) => {
    if (!MONITOR_GRAFANA_TOKEN) {
        return res.status(503).json({ error: 'Monitoring not configured' });
    }

    try {
        const results = await grafanaPrometheusInstant(
            'sum by (namespace) (kube_pod_info{created_by_kind="ReplicaSet"})'
        );

        const tenants = results
            .filter(r => r.metric && r.metric.namespace)
            .map(r => ({
                namespace: r.metric.namespace,
                count: parseInt((r.value && r.value[1]) || '0', 10),
                services: [],
            }))
            .filter(t => t.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 30);

        // Enrich each tenant with its service list from Loki series
        const now = monitorNowSeconds();
        const start = now - 3600;

        await Promise.all(tenants.map(async (tenant) => {
            const params = new URLSearchParams({
                'match[]': `{eyevinnlabel_customer="${tenant.namespace}"}`,
                start: String(start),
                end: String(now),
            });
            const url = `${MONITOR_LOKI_BASE}/series?${params}`;
            try {
                const r = await fetch(url, { headers: monitorAuthHeaders() });
                if (!r.ok) return;
                const data = await r.json();
                if (data.status !== 'success') return;
                const services = new Set();
                for (const labelSet of data.data) {
                    if (labelSet.eyevinnlabel_service) {
                        services.add(labelSet.eyevinnlabel_service);
                    }
                }
                tenant.services = Array.from(services);
            } catch {
                // leave services as empty array
            }
        }));

        return res.json({ tenants });
    } catch (err) {
        console.error('Monitor instances/current error:', err);
        return res.status(500).json({ error: String(err) });
    }
});

// GET /api/monitor/instances/graph
// Params: range (1h|6h|12h|24h|48h|7d, default 6h)
// Returns time series grouped by tenant (derived from pod name prefix).
app.get('/api/monitor/instances/graph', async (req, res) => {
    if (!MONITOR_GRAFANA_TOKEN) {
        return res.status(503).json({ error: 'Monitoring not configured' });
    }

    try {
        const range = req.query.range || '6h';
        const now = monitorNowSeconds();
        const rangeSecs = monitorRangeSeconds(range);
        const start = now - rangeSecs;
        const step = monitorStepForRange(rangeSecs);

        const results = await grafanaPrometheus(
            'count by (pod)(kube_pod_info{created_by_kind="ReplicaSet"})',
            start,
            now,
            step
        );

        // Aggregate by tenant (first dash-separated segment of pod name)
        const tenantMap = new Map();

        for (const r of results) {
            const podName = (r.metric && r.metric.pod) || '';
            const tenant = podName.split('-')[0];
            if (!tenant) continue;

            if (!tenantMap.has(tenant)) tenantMap.set(tenant, new Map());
            const tsMap = tenantMap.get(tenant);

            for (const [ts, val] of (r.values || [])) {
                const msTs = ts * 1000;
                tsMap.set(msTs, (tsMap.get(msTs) || 0) + parseInt(val, 10));
            }
        }

        const series = Array.from(tenantMap.entries())
            .map(([tenant, tsMap]) => ({
                namespace: tenant,
                data: Array.from(tsMap.entries())
                    .sort(([a], [b]) => a - b)
                    .map(([time, value]) => ({ time, value })),
            }))
            .filter(s => s.data.some(d => d.value > 0));

        return res.json({ series, range, step });
    } catch (err) {
        console.error('Monitor instances/graph error:', err);
        return res.status(500).json({ error: String(err) });
    }
});

// GET /api/monitor/instances/drilldown
// Params: namespace (required), range (default 6h)
// Returns per-service pod time series for a single tenant namespace.
app.get('/api/monitor/instances/drilldown', async (req, res) => {
    if (!MONITOR_GRAFANA_TOKEN) {
        return res.status(503).json({ error: 'Monitoring not configured' });
    }

    const namespace = req.query.namespace;
    if (!namespace) {
        return res.status(400).json({ error: 'namespace is required' });
    }

    try {
        const range = req.query.range || '6h';
        const now = monitorNowSeconds();
        const rangeSecs = monitorRangeSeconds(range);
        const start = now - rangeSecs;
        const step = monitorStepForRange(rangeSecs);

        const results = await grafanaPrometheus(
            `sum by (namespace)(kube_pod_info{pod=~"^${namespace}-.*",created_by_kind="ReplicaSet"})`,
            start,
            now,
            step
        );

        const series = results
            .map(r => ({
                service: (r.metric && r.metric.namespace) || 'unknown',
                data: (r.values || []).map(([ts, val]) => ({
                    time: parseInt(String(ts), 10) * 1000,
                    value: parseInt(val, 10),
                })),
            }))
            .filter(s => s.data.some(d => d.value > 0));

        return res.json({ series, namespace, range });
    } catch (err) {
        console.error('Monitor instances/drilldown error:', err);
        return res.status(500).json({ error: String(err) });
    }
});

// ================================
// DAILY BRIEFS API
// ================================

// Helper: fetch all brief_items for a briefId
async function fetchBriefItems(briefId) {
    const startKey = encodeURIComponent(JSON.stringify([briefId]));
    const endKey = encodeURIComponent(JSON.stringify([briefId, {}]));
    const viewUrl = `${dbUrl}/_design/contacts/_view/all_brief_items?startkey=${startKey}&endkey=${endKey}`;
    const res = await couchFetch(viewUrl);
    if (!res.ok) return [];
    const data = await res.json();
    return data.rows.map(row => {
        const { _id, _rev, type, ...item } = row.value;
        return { id: _id, ...item };
    });
}

// Helper: bulk update sortOrder (or a named order field) for an array of { id, <orderField> }
// orderField defaults to 'sortOrder'; pass 'cardOrder' for tracked customers
async function bulkReorderDocs(order, orderField = 'sortOrder') {
    const docs = await Promise.all(order.map(async (item) => {
        const id = item.id;
        const value = item[orderField];
        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);
        if (!getResponse.ok) return null;
        const doc = await getResponse.json();
        doc[orderField] = value;
        doc.updatedAt = new Date().toISOString();
        return doc;
    }));
    const validDocs = docs.filter(Boolean);
    if (validDocs.length === 0) return;
    const bulkResponse = await couchFetch(`${dbUrl}/_bulk_docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docs: validDocs })
    });
    if (!bulkResponse.ok) throw new Error('Bulk reorder failed');
}

// Helper: bulk delete docs by id (fetches current _rev)
async function bulkDeleteDocs(ids) {
    if (ids.length === 0) return;
    const docs = await Promise.all(ids.map(async id => {
        const r = await couchFetch(`${dbUrl}/${id}`);
        if (!r.ok) return null;
        const doc = await r.json();
        return { _id: doc._id, _rev: doc._rev, _deleted: true };
    }));
    const valid = docs.filter(Boolean);
    if (valid.length === 0) return;
    await couchFetch(`${dbUrl}/_bulk_docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docs: valid })
    });
}

// GET /api/briefs — list briefs newest-first with item counts
app.get('/api/briefs', async (req, res) => {
    try {
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_briefs`;
        const viewRes = await couchFetch(viewUrl);
        if (!viewRes.ok) return res.json({ briefs: [] });

        const viewData = await viewRes.json();
        const briefs = viewData.rows.map(row => {
            const { _id, _rev, type, ...brief } = row.value;
            return { id: _id, ...brief, totalItems: 0, completedItems: 0 };
        });

        // Fetch all brief_items in one view call and group by briefId
        const itemsViewUrl = `${dbUrl}/_design/contacts/_view/all_brief_items`;
        const itemsRes = await couchFetch(itemsViewUrl);
        if (itemsRes.ok) {
            const itemsData = await itemsRes.json();
            const countMap = {};
            itemsData.rows.forEach(row => {
                const briefId = row.key[0];
                if (!countMap[briefId]) countMap[briefId] = { total: 0, completed: 0 };
                countMap[briefId].total++;
                if (row.value.completed) countMap[briefId].completed++;
            });
            briefs.forEach(brief => {
                const counts = countMap[brief.id] || { total: 0, completed: 0 };
                brief.totalItems = counts.total;
                brief.completedItems = counts.completed;
            });
        }

        // Sort newest first
        briefs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        res.json({ briefs });
    } catch (err) {
        console.error('Error fetching briefs:', err);
        res.status(500).json({ error: 'Failed to fetch briefs' });
    }
});

// POST /api/briefs — create (or replace) a brief + its items
// Accepts API key OR cookie auth
app.post('/api/briefs', async (req, res) => {
    // Allow API key auth (if no API_KEY configured, treat as open) OR cookie auth
    const apiKeyValid = !API_KEY || (req.headers['x-api-key'] === API_KEY || req.query.apiKey === API_KEY);
    const cookieAuth = isAuthenticated(req);
    if (!apiKeyValid && !cookieAuth) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { date, generatedAt, metricsSnapshot, items } = req.body;
        if (!date) return res.status(400).json({ error: 'date is required' });

        const briefId = `brief-${date}`;
        const now = new Date().toISOString();

        // Upsert brief document
        const docUrl = `${dbUrl}/${briefId}`;
        const existing = await couchFetch(docUrl);
        let briefDoc;
        if (existing.ok) {
            briefDoc = await existing.json();
            // Delete all existing items for this brief
            const oldItems = await fetchBriefItems(briefId);
            await bulkDeleteDocs(oldItems.map(i => i.id));
        } else {
            briefDoc = { _id: briefId, type: 'daily_brief' };
        }

        briefDoc.date = date;
        briefDoc.generatedAt = generatedAt || now;
        briefDoc.metricsSnapshot = metricsSnapshot || null;
        briefDoc.archived = briefDoc.archived || false;
        briefDoc.updatedAt = now;
        if (!briefDoc.createdAt) briefDoc.createdAt = now;

        const saveRes = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(briefDoc)
        });
        if (!saveRes.ok) throw new Error('Failed to save brief');

        // Create brief_item docs in bulk
        const itemArray = Array.isArray(items) ? items : [];
        if (itemArray.length > 0) {
            const itemDocs = itemArray.map((item, i) => ({
                _id: `brief-item-${Date.now()}-${i}`,
                type: 'brief_item',
                briefId,
                priority: item.priority || 'MEDIUM',
                title: item.title || '',
                description: item.description || '',
                source: item.source || '',
                completed: false,
                completedAt: null,
                archived: false,
                sortOrder: i * 10,
                createdAt: now,
                updatedAt: now
            }));
            const bulkRes = await couchFetch(`${dbUrl}/_bulk_docs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ docs: itemDocs })
            });
            if (!bulkRes.ok) throw new Error('Failed to create brief items');
        }

        res.json({ success: true, briefId, itemCount: itemArray.length });
    } catch (err) {
        console.error('Error creating brief:', err);
        res.status(500).json({ error: 'Failed to create brief' });
    }
});

// PATCH /api/briefs/:id — archive/unarchive
app.patch('/api/briefs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { archived } = req.body;

        const docUrl = `${dbUrl}/${id}`;
        const getRes = await couchFetch(docUrl);
        if (!getRes.ok) return res.status(404).json({ error: 'Brief not found' });

        const doc = await getRes.json();
        if (archived !== undefined) doc.archived = Boolean(archived);
        doc.updatedAt = new Date().toISOString();

        const updateRes = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });
        if (!updateRes.ok) throw new Error('Failed to update brief');
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating brief:', err);
        res.status(500).json({ error: 'Failed to update brief' });
    }
});

// DELETE /api/briefs/:id — delete brief and all its items
app.delete('/api/briefs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const docUrl = `${dbUrl}/${id}`;
        const getRes = await couchFetch(docUrl);
        if (!getRes.ok) return res.status(404).json({ error: 'Brief not found' });

        const doc = await getRes.json();

        // Delete all items first
        const items = await fetchBriefItems(id);
        await bulkDeleteDocs(items.map(i => i.id));

        // Delete the brief doc
        const delRes = await couchFetch(`${docUrl}?rev=${doc._rev}`, { method: 'DELETE' });
        if (!delRes.ok) throw new Error('Failed to delete brief');

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting brief:', err);
        res.status(500).json({ error: 'Failed to delete brief' });
    }
});

// GET /api/brief-items?briefId=xxx
app.get('/api/brief-items', async (req, res) => {
    try {
        const { briefId } = req.query;
        if (!briefId) return res.status(400).json({ error: 'briefId is required' });

        const items = await fetchBriefItems(briefId);
        items.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
        res.json({ items });
    } catch (err) {
        console.error('Error fetching brief items:', err);
        res.status(500).json({ error: 'Failed to fetch brief items' });
    }
});

// POST /api/brief-items/reorder — must be before /:id routes
app.post('/api/brief-items/reorder', async (req, res) => {
    try {
        const { order } = req.body;
        if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
        await bulkReorderDocs(order, 'sortOrder');
        res.json({ success: true });
    } catch (err) {
        console.error('Error reordering brief items:', err);
        res.status(500).json({ error: 'Failed to reorder brief items' });
    }
});

// POST /api/brief-items — manually create an item
app.post('/api/brief-items', async (req, res) => {
    try {
        const { briefId, priority, title, description, source } = req.body;
        if (!briefId) return res.status(400).json({ error: 'briefId is required' });
        if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });

        // Auto-create brief for today if briefId doesn't exist
        const briefDocUrl = `${dbUrl}/${briefId}`;
        const briefCheck = await couchFetch(briefDocUrl);
        if (!briefCheck.ok) {
            const date = briefId.replace('brief-', '');
            const now = new Date().toISOString();
            const briefDoc = {
                _id: briefId,
                type: 'daily_brief',
                date,
                generatedAt: now,
                metricsSnapshot: null,
                archived: false,
                createdAt: now,
                updatedAt: now
            };
            await couchFetch(briefDocUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(briefDoc)
            });
        }

        const now = new Date().toISOString();
        const id = `brief-item-${Date.now()}`;
        const doc = {
            _id: id,
            type: 'brief_item',
            briefId,
            priority: priority || 'MEDIUM',
            title: title.trim(),
            description: description || '',
            source: source || '',
            completed: false,
            completedAt: null,
            archived: false,
            sortOrder: null,
            createdAt: now,
            updatedAt: now
        };

        const saveRes = await couchFetch(`${dbUrl}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });
        if (!saveRes.ok) throw new Error('Failed to create brief item');

        res.json({ success: true, item: { id, ...doc } });
    } catch (err) {
        console.error('Error creating brief item:', err);
        res.status(500).json({ error: 'Failed to create brief item' });
    }
});

// PATCH /api/brief-items/:id — update item fields
app.patch('/api/brief-items/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { completed, title, description, source, priority, archived, sortOrder } = req.body;

        const docUrl = `${dbUrl}/${id}`;
        const getRes = await couchFetch(docUrl);
        if (!getRes.ok) return res.status(404).json({ error: 'Brief item not found' });

        const doc = await getRes.json();
        if (completed !== undefined) {
            doc.completed = Boolean(completed);
            if (completed && !doc.completedAt) doc.completedAt = new Date().toISOString();
            if (!completed) doc.completedAt = null;
        }
        if (title !== undefined) doc.title = title.trim();
        if (description !== undefined) doc.description = description;
        if (source !== undefined) doc.source = source;
        if (priority !== undefined) doc.priority = priority;
        if (archived !== undefined) doc.archived = Boolean(archived);
        if (sortOrder !== undefined) doc.sortOrder = sortOrder;
        doc.updatedAt = new Date().toISOString();

        const updateRes = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });
        if (!updateRes.ok) throw new Error('Failed to update brief item');

        const { _id, _rev, type, ...clean } = doc;
        res.json({ success: true, item: { id: _id, ...clean } });
    } catch (err) {
        console.error('Error updating brief item:', err);
        res.status(500).json({ error: 'Failed to update brief item' });
    }
});

// DELETE /api/brief-items/:id
app.delete('/api/brief-items/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const docUrl = `${dbUrl}/${id}`;
        const getRes = await couchFetch(docUrl);
        if (!getRes.ok) return res.status(404).json({ error: 'Brief item not found' });

        const doc = await getRes.json();
        const delRes = await couchFetch(`${docUrl}?rev=${doc._rev}`, { method: 'DELETE' });
        if (!delRes.ok) throw new Error('Failed to delete brief item');
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting brief item:', err);
        res.status(500).json({ error: 'Failed to delete brief item' });
    }
});

// ==================== VIDEO PLANNER ====================

// Helper: dual auth for video endpoints (API key OR cookie)
function requireVideoAuth(req, res) {
    const apiKeyValid = !API_KEY || (req.headers['x-api-key'] === API_KEY || req.query.apiKey === API_KEY);
    const cookieAuth = isAuthenticated(req);
    if (!apiKeyValid && !cookieAuth) {
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    return true;
}

app.get('/api/videos', async (req, res) => {
    if (!requireVideoAuth(req, res)) return;
    try {
        const viewUrl = `${dbUrl}/_design/contacts/_view/all_videos`;
        const viewResponse = await couchFetch(viewUrl);

        if (!viewResponse.ok) {
            return res.json({ videos: [] });
        }

        const viewData = await viewResponse.json();
        const videos = viewData.rows.map(row => {
            const { _id, _rev, type, ...item } = row.value;
            return { id: _id, ...item };
        });

        // Sort by status order, then by createdAt within each status
        const statusOrder = { 'idea': 0, 'scripted': 1, 'filmed': 2, 'edited': 3, 'posted': 4 };
        videos.sort((a, b) => {
            const aRank = statusOrder[a.status] ?? 5;
            const bRank = statusOrder[b.status] ?? 5;
            if (aRank !== bRank) return aRank - bRank;
            return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        });

        // Optional filters via query params
        let filtered = videos;
        if (req.query.week) {
            filtered = filtered.filter(v => v.week === req.query.week);
        }
        if (req.query.brand) {
            filtered = filtered.filter(v => v.brand === req.query.brand);
        }
        if (req.query.status) {
            filtered = filtered.filter(v => v.status === req.query.status);
        }

        res.json({ videos: filtered });
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ error: 'Failed to fetch videos' });
    }
});

// GET single video by ID (for agents to read back full details)
app.get('/api/videos/:id', async (req, res) => {
    if (!requireVideoAuth(req, res)) return;
    try {
        const { id } = req.params;
        const docUrl = `${dbUrl}/${id}`;
        const response = await couchFetch(docUrl);

        if (!response.ok) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const doc = await response.json();
        if (doc.type !== 'video') {
            return res.status(404).json({ error: 'Video not found' });
        }

        const { _id, _rev, type, ...item } = doc;
        res.json({ video: { id: _id, ...item } });
    } catch (error) {
        console.error('Error fetching video:', error);
        res.status(500).json({ error: 'Failed to fetch video' });
    }
});

app.post('/api/videos', async (req, res) => {
    if (!requireVideoAuth(req, res)) return;
    try {
        const { title, description, platforms, status,
                notes, week, brand,
                hook, duration, cameraType, context, directorNotes,
                manuscript, recordingInstructions,
                codexPrompts, editingTimeline, editingNotes,
                captions, postingNotes } = req.body;

        if (!title) {
            return res.status(400).json({ error: 'title is required' });
        }

        const id = `video-${Date.now()}`;
        const doc = {
            _id: id,
            type: 'video',
            title,
            description: description || '',
            notes: notes || '',
            week: week || '',
            brand: brand || '',
            platforms: platforms || [],
            status: status || 'idea',
            postedOn: [],
            // Structured production fields
            hook: hook || '',
            duration: duration || '',
            cameraType: cameraType || '',
            context: context || '',
            directorNotes: directorNotes || '',
            manuscript: manuscript || '',
            recordingInstructions: recordingInstructions || '',
            codexPrompts: codexPrompts || [],        // [{label, prompt}]
            editingTimeline: editingTimeline || [],   // [{time, action, overlay}]
            editingNotes: editingNotes || '',
            captions: captions || {},                 // {tiktok, instagram, youtube, facebook}
            postingNotes: postingNotes || {},          // {tiktok, instagram, youtube, facebook}
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const docUrl = `${dbUrl}/${id}`;
        const response = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!response.ok) throw new Error('Failed to create video');

        res.json({ success: true, id, video: { id, ...doc } });
    } catch (error) {
        console.error('Error creating video:', error);
        res.status(500).json({ error: 'Failed to create video' });
    }
});

app.patch('/api/videos/:id', async (req, res) => {
    if (!requireVideoAuth(req, res)) return;
    try {
        const { id } = req.params;
        const body = req.body;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const doc = await getResponse.json();

        // All patchable video fields
        const patchableFields = [
            'title', 'description', 'notes', 'week', 'brand',
            'platforms', 'status', 'postedOn',
            'hook', 'duration', 'cameraType', 'context', 'directorNotes',
            'manuscript', 'recordingInstructions',
            'codexPrompts', 'editingTimeline', 'editingNotes',
            'captions', 'postingNotes'
        ];
        for (const field of patchableFields) {
            if (body[field] !== undefined) doc[field] = body[field];
        }
        doc.updatedAt = new Date().toISOString();

        const updateResponse = await couchFetch(docUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        });

        if (!updateResponse.ok) throw new Error('Failed to update video');

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating video:', error);
        res.status(500).json({ error: 'Failed to update video' });
    }
});

app.delete('/api/videos/:id', async (req, res) => {
    if (!requireVideoAuth(req, res)) return;
    try {
        const { id } = req.params;

        const docUrl = `${dbUrl}/${id}`;
        const getResponse = await couchFetch(docUrl);

        if (!getResponse.ok) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const doc = await getResponse.json();
        const deleteResponse = await couchFetch(`${docUrl}?rev=${doc._rev}`, { method: 'DELETE' });

        if (!deleteResponse.ok) throw new Error('Failed to delete video');

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting video:', error);
        res.status(500).json({ error: 'Failed to delete video' });
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
