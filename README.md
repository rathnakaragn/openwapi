# OpenWAPI v1.0

Open WhatsApp API - Self-hosted solution for automated message handling. Built with Node.js, Express, and Baileys WebSocket client.

## Features

- **WhatsApp Integration**: Receive and reply to WhatsApp messages via Baileys
- **Image Support**: Send and receive images with captions
- **REST API**: Comprehensive API with X-API-Key authentication
- **Web Dashboard**: Login, QR scanning, message management (Alpine.js + Tailwind CSS)
- **Webhooks**: Real-time notifications for incoming messages
- **SQLite Database**: Message storage with WAL mode for performance
- **IST Timezone**: All timestamps saved in Indian Standard Time (24-hour format)
- **Session Persistence**: Multi-file auth state storage
- **Auto-reconnection**: Automatic reconnection with exponential backoff
- **Docker Ready**: Full Docker and Docker Swarm support
- **Production Ready**: PM2 configuration, health checks, graceful shutdown
- **Test Suite**: Comprehensive Jest tests (45 test cases)

## Quick Start

### 1. Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials (optional)
nano .env
```

### 2. Start Server

**Option A: Docker Compose (Recommended)**
```bash
# Start the API
docker-compose up -d

# View logs
docker-compose logs -f openwapi

# Stop the API
docker-compose down
```

**Option B: Direct Node.js**
```bash
# Development mode
npm start

# Production with PM2
npm run pm2:start
```

**Option C: Docker (Manual)**
```bash
docker build -t openwapi:1.0 .
docker run -d -p 3001:3001 \
  -v openwapi-data:/app/data \
  --name openwapi \
  openwapi:1.0
```

### 3. Connect WhatsApp

1. Open browser: `http://localhost:3001/login.html`
2. Login with default credentials: `admin` / `admin123`
3. Scan QR code with WhatsApp mobile app
4. Start using the API!

## API Overview

The API provides 11 REST endpoints for managing WhatsApp messages and webhooks.

### Authentication

Two authentication methods:
- **API Key**: Header `X-API-Key` for API endpoints
- **Basic Auth**: HTTP Basic Authentication for dashboard endpoints

### Quick Example

```bash
# Get your API key
curl -u admin:admin123 http://localhost:3001/api/v1/config

# Get inbox messages
curl -H "X-API-Key: YOUR_KEY" http://localhost:3001/api/v1/inbox

# Reply with text
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}' \
  http://localhost:3001/api/v1/messages/1/reply

# Reply with image (URL)
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Check this!", "image": "https://example.com/photo.jpg"}' \
  http://localhost:3001/api/v1/messages/1/reply

# Reply with image (base64)
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"image": "iVBORw0KGgo..."}' \
  http://localhost:3001/api/v1/messages/1/reply

# Update message status
curl -X PATCH \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "ignored"}' \
  http://localhost:3001/api/v1/messages/1/status
```

### API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/health` | GET | Public | Health check |
| `/api/v1/qr` | GET | Public | Get QR code for WhatsApp login |
| `/api/v1/config` | GET | Basic Auth | Get API key and configuration |
| `/api/v1/status` | GET | API Key | Get connection status |
| `/api/v1/logout` | POST | API Key | Logout from WhatsApp |
| `/api/v1/inbox` | GET | API Key | Get all unread incoming messages |
| `/api/v1/messages/:id/reply` | POST | API Key | Reply to a message |
| `/api/v1/messages/:id/status` | PATCH | API Key | Update message status |
| `/api/v1/webhook` | GET | Basic Auth | Get configured webhook |
| `/api/v1/webhook` | POST | Basic Auth | Configure webhook URL |
| `/api/v1/webhook` | DELETE | Basic Auth | Delete webhook |

## Project Structure

```
openwapi/
├── app.js                      # Entry point - Express server setup
├── package.json                # Dependencies & scripts
├── .env.example                # Environment template
│
├── docker-compose.yml          # Docker Compose config
├── docker-compose.swarm.yml    # Docker Swarm production config
├── Dockerfile                  # Docker image build
├── ecosystem.config.js         # PM2 process manager config
│
├── src/
│   ├── api/                    # API Layer
│   │   ├── routes.js           # 11 REST endpoints + auth middleware
│   │   ├── whatsapp.js         # Baileys WebSocket client & event handlers
│   │   ├── config.js           # Environment configuration loader
│   │   ├── logger.js           # Pino logger setup
│   │   └── state.js            # WhatsApp connection state management
│   │
│   └── database/               # Database Layer
│       └── index.js            # SQLite schema, queries & operations
│
├── image/                      # Downloaded images (auto-created)
│   └── {messageId}.jpg         # Images named by message ID
│
├── public/                     # Web Dashboard (Alpine.js + Tailwind CSS)
│   ├── index.html              # Root redirect to login
│   ├── login.html              # Dashboard authentication
│   ├── scan.html               # QR code scanner page
│   └── dashboard.html          # Main dashboard (messages, webhook config)
│
└── tests/                      # Test Suite
    ├── database.test.js        # Database layer tests
    └── routes.test.js          # API endpoint tests
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Runtime** | Node.js 20 | JavaScript runtime |
| **Framework** | Express.js 4 | REST API server |
| **WhatsApp** | Baileys 7.0 | WhatsApp Web WebSocket client |
| **Database** | better-sqlite3 | SQLite with WAL mode |
| **Logger** | Pino | High-performance JSON logging |
| **Frontend** | Alpine.js 3 + Tailwind CSS | Reactive dashboard UI |
| **QR Codes** | qrcode | QR code generation |
| **Process Manager** | PM2 | Production process management |
| **Testing** | Jest + Supertest | Unit & integration tests |
| **Container** | Docker + Docker Swarm | Containerization & orchestration |

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `DASHBOARD_USER` | admin | Dashboard username (Basic Auth) |
| `DASHBOARD_PASSWORD` | admin123 | Dashboard password (Basic Auth) |
| `DB_PATH` | ./messages.db | SQLite database file path |
| `SESSION_PATH` | ./session | WhatsApp session storage path |
| `MEDIA_PATH` | ./image | Downloaded images storage path |
| `NODE_ENV` | development | Environment mode (development/production) |

**Note**: API key is auto-generated on first start and stored in the database.

## Docker Deployment

### Using Docker Compose (Recommended)

**Basic Setup:**
```bash
# Start the service
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f openwapi

# Stop service
docker-compose down
```

**Custom Configuration:**
1. Copy and edit `docker-compose.yml`
2. Update environment variables:
   - `DASHBOARD_USER` - Change default username
   - `DASHBOARD_PASSWORD` - Change default password
   - **Note:** API key is auto-generated, no need to configure
3. Restart: `docker-compose up -d`

**Getting Your API Key:**
```bash
# Option 1: From dashboard
# Login at http://localhost:3001/login.html

# Option 2: Via API
curl -u admin:admin123 http://localhost:3001/api/v1/config

# Option 3: From Docker logs (shown on first start)
docker-compose logs openwapi | grep "API Key:"
```

**Data Persistence:**
- All data stored in Docker volume `openwapi-data`
- Includes: database, WhatsApp session, images
- Backup: `docker run --rm -v openwapi-data:/data -v $(pwd):/backup alpine tar czf /backup/openwapi-backup.tar.gz -C /data .`
- Restore: `docker run --rm -v openwapi-data:/data -v $(pwd):/backup alpine tar xzf /backup/openwapi-backup.tar.gz -C /data`

### Docker Swarm Deployment

For production clusters, use the Swarm-compatible configuration:

**Prerequisites:**
```bash
# Initialize Swarm (if not already)
docker swarm init

# Build and tag the image
docker build -t openwapi:1.0 .

# Optional: Push to registry
docker tag openwapi:1.0 your-registry/openwapi:1.0
docker push your-registry/openwapi:1.0
```

**Deploy to Swarm:**
```bash
# Deploy the stack
docker stack deploy -c docker-compose.swarm.yml openwapi

# Check status
docker stack ps openwapi

# View logs
docker service logs -f openwapi_openwapi

# Scale service (if needed)
docker service scale openwapi_openwapi=1

# Remove stack
docker stack rm openwapi
```

**Swarm Features:**
- Auto-restart on failure
- Rolling updates
- Automatic rollback
- Resource limits (512MB RAM, 1 CPU)
- Health monitoring
- High availability (when using multiple nodes)

## Webhooks

Configure webhooks to receive real-time notifications when messages arrive.

**Setup:**
1. Login to dashboard: `http://localhost:3001/login.html`
2. Navigate to Webhook Configuration section
3. Enter your webhook URL
4. Click "Save Webhook"

**Webhook Payload:**
```json
{
  "event": "message.received",
  "message": {
    "id": 123,
    "from": "1234567890@s.whatsapp.net",
    "text": "Message content or image caption",
    "mediaType": "image",
    "mediaUrl": "123.jpg",
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

**Webhook Requirements:**
- Must accept POST requests
- Must respond with 2xx status
- 5-second timeout
- Fire-and-forget (no retry in v1.0)

**Testing Webhooks:**

Option 1: Use webhook.site (easiest)
```
1. Visit https://webhook.site
2. Copy your unique URL
3. Configure in dashboard
4. View real-time requests
```

Option 2: Simple Node.js test server
```bash
# Create test server
node -e "
const http = require('http');
http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    console.log('Webhook received:', body);
    res.writeHead(200);
    res.end('OK');
  });
}).listen(3002, () => console.log('Webhook test server on port 3002'));
"

# Configure webhook: http://localhost:3002
```

Option 3: Use ngrok for public URL
```bash
# Install ngrok, then:
ngrok http 3002

# Use the ngrok URL in webhook configuration
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Architecture

### Database Schema

**messages** table:
- `id` - Auto-increment primary key
- `direction` - 'incoming' or 'outgoing'
- `phone` - WhatsApp JID (phone@s.whatsapp.net)
- `message` - Text content or image caption
- `reply_status` - 'unread', 'replied', 'ignored', 'sent'
- `media_type` - 'image' or null for text-only
- `media_url` - File path to saved image or null
- `created_at` - Timestamp (IST 24-hour format)

**Note:** Dashboard "Total Messages" count only shows incoming messages.

**api_keys** table:
- Auto-generated 32-byte base64 key
- Single shared key for all API requests

**webhooks** table:
- URL, event type, active status
- Supports 'message.received' event

**settings** table:
- Key-value configuration storage

### Security Features

- **Timing-safe string comparison** - Prevents timing attacks on auth
- **Auto-generated API keys** - Secure 32-byte random keys
- **HTTPS recommended** - Use reverse proxy for production
- **Basic Auth** - Dashboard protected with HTTP Basic Authentication
- **Input validation** - All inputs validated before processing

## Limitations & Design Decisions

### Current Limitations (v1.0)
- **Images only** - No support for videos, documents, audio (images supported)
- **Reply-only mode** - Cannot initiate new conversations (only reply to incoming messages)
- **Single API key** - One shared key for all API requests
- **No rate limiting** - No built-in request throttling
- **Single instance** - Not designed for horizontal scaling
- **Webhook fire-and-forget** - No retry mechanism (5s timeout)
- **No message pagination** - Inbox returns all unread messages
- **Simple authentication** - Basic Auth for dashboard, API key for endpoints

### Why These Limitations?

This is a **v1.0 MVP** focused on:
- Core functionality working reliably
- Simple deployment (Docker/PM2)
- Easy to understand codebase
- Production-ready features (health checks, logging, tests)

## Planned Features (v2.0+)

- Additional media support (videos, documents, audio)
- Send messages to new numbers (not just replies)
- Webhook retry mechanism with exponential backoff
- Multiple API keys with permissions
- Rate limiting per API key
- Advanced message filtering and search
- Batch operations (bulk reply, bulk status update)
- Horizontal scaling support (multiple instances)
- Message pagination and advanced queries
- Message templates and quick replies
- Analytics and reporting

## Development

### Running Locally

```bash
# Install dependencies
npm install

# Start in development mode (with nodemon)
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Contributing

This is a self-hosted solution. Feel free to fork and customize for your needs.

## License

MIT

## Support

For issues and questions:
1. Check this README for configuration and deployment instructions
2. Review the codebase (it's well-documented!)
3. Open an issue on your repository

---

**Version:** 1.0.0
**Status:** Production Ready MVP
**Stack:** Node.js + Express + Baileys + SQLite
**License:** MIT
