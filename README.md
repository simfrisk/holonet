# OSC Sales Contact List Server

A Node.js server with CouchDB backend for managing sales contacts extracted from Slack.

## Features

- 📊 Contact management dashboard
- 💾 CouchDB persistence
- 📝 Notes and contact tracking
- 🔄 Auto-sync from Slack agent
- 🔒 Optional API key protection

## Deployment to OSC

### Prerequisites

1. OSC account at https://app.osaas.io
2. CouchDB database (create via OSC)

### Deploy Steps

1. **Create CouchDB Database in OSC**:
   ```bash
   # Using OSC MCP or web interface
   # Create a CouchDB instance and get connection URL
   # Example: https://admin:password@tenant-dbname.apache-couchdb.auto.prod.osaas.io/
   ```

2. **Deploy to OSC**:
   ```bash
   # This repository is deployed using OSC my-app
   # Type: nodejs
   # GitHub URL: [your-repo-url]
   ```

3. **Set Environment Variables in OSC**:
   - `COUCHDB_URL` - Your CouchDB connection string
   - `API_KEY` - (Optional) Secret key for /api/sync endpoint
   - `PORT` - (Auto-set by OSC, usually 8080)

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `COUCHDB_URL` | Yes | CouchDB connection string (e.g., `https://admin:pass@host.osaas.io`) |
| `SESSION_SECRET` | Yes | Secret key for signing auth tokens |
| `LOGIN_PASSWORD` | No | Password for login protection |
| `API_KEY` | No | API key for sync endpoint protection |
| `PORT` | No | Server port (default: 8080) |

## API Endpoints

### GET /api/health
Health check endpoint

**Response**:
```json
{
  "status": "ok",
  "database": "connected",
  "port": 8080,
  "timestamp": "2026-02-17T16:00:00.000Z"
}
```

### GET /api/contacts
Get all contacts

**Response**:
```json
{
  "metadata": {
    "totalContacts": 10,
    "contacted": 3,
    "pendingOutreach": 7,
    "lastCheckDate": "2026-02-17T16:00:00.000Z"
  },
  "contacts": [...]
}
```

### PATCH /api/contacts/:id/notes
Update contact notes

**Body**:
```json
{
  "notes": "Follow up next week about pricing"
}
```

### PATCH /api/contacts/:id/contacted
Mark contact as contacted/archived

**Body**:
```json
{
  "contacted": true
}
```

### POST /api/sync
Sync contact data from Slack agent

**Headers** (if API_KEY is set):
```
X-Api-Key: your-api-key
```

**Body**:
```json
{
  "metadata": {
    "totalContacts": 10,
    "lastCheckDate": "2026-02-17T16:00:00.000Z"
  },
  "contacts": [
    {
      "id": "contact-1",
      "name": "John Doe",
      "email": "john@example.com",
      "tenantName": "acme-corp",
      "priority": "high",
      ...
    }
  ]
}
```

## Local Development

```bash
# Install dependencies
npm install

# Set environment variables
export COUCHDB_URL="http://admin:password@localhost:5984"
export SESSION_SECRET="your-secret-key"
export API_KEY="your-secret-key"

# Start server
npm start
```

## Syncing from Slack Agent

The Slack agent should POST to the `/api/sync` endpoint:

```javascript
const response = await fetch('https://your-app.apps.osaas.io/api/sync', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': 'your-api-key' // if API_KEY is set
  },
  body: JSON.stringify({
    metadata: { ... },
    contacts: [ ... ]
  })
});
```

## Data Persistence

- **Notes**: Preserved across syncs
- **Contacted status**: Preserved across syncs
- **Contact data**: Refreshed from Slack on each sync

## License

MIT
