const express = require('express');
const request = require('supertest');
const Database = require('better-sqlite3');
const { createRoutes } = require('../src/api/routes');
const { insertMessage, ensureApiKey } = require('../src/database');
const { WhatsAppState } = require('../src/api/state');

describe('API Routes', () => {
  let app;
  let db;
  let whatsappState;
  let apiKey;
  const config = {
    DASHBOARD_USER: 'testuser',
    DASHBOARD_PASSWORD: 'testpass'
  };

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');

    // Initialize schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL,
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        reply_status TEXT DEFAULT 'unread',
        media_type TEXT,
        media_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(reply_status);
      CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Generate API key
    apiKey = ensureApiKey(db);

    // Create WhatsApp state
    whatsappState = new WhatsAppState();

    // Create Express app
    app = express();
    app.use(express.json());

    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    const routes = createRoutes(db, whatsappState, config, logger);
    app.use('/api/v1', routes);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('GET /health', () => {
    test('should return 200 with success message', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.version).toBe('1.0.0');
    });
  });

  describe('GET /qr', () => {
    test('should return error when already connected', async () => {
      whatsappState.setConnected(true, '1234567890');

      const res = await request(app).get('/api/v1/qr');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Already connected');
    });

    test('should return QR code when available', async () => {
      whatsappState.setQrCode('data:image/png;base64,abc123');

      const res = await request(app).get('/api/v1/qr');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.qr).toBe('data:image/png;base64,abc123');
    });

    test('should return error when QR not available', async () => {
      const res = await request(app).get('/api/v1/qr');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not available');
    });
  });

  describe('GET /config', () => {
    test('should require Basic Auth', async () => {
      const res = await request(app).get('/api/v1/config');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('should reject invalid credentials', async () => {
      const res = await request(app)
        .get('/api/v1/config')
        .auth('wrong', 'wrong');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('should return config with valid credentials', async () => {
      const res = await request(app)
        .get('/api/v1/config')
        .auth(config.DASHBOARD_USER, config.DASHBOARD_PASSWORD);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.apiKey).toBe(apiKey);
    });
  });

  describe('GET /status', () => {
    test('should require API key', async () => {
      const res = await request(app).get('/api/v1/status');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('API key required');
    });

    test('should reject invalid API key', async () => {
      const res = await request(app)
        .get('/api/v1/status')
        .set('X-API-Key', 'invalid-key');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid API key');
    });

    test('should return status with valid API key', async () => {
      whatsappState.setConnected(true, '1234567890');

      const res = await request(app)
        .get('/api/v1/status')
        .set('X-API-Key', apiKey);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.connected).toBe(true);
      expect(res.body.data.phone).toBe('1234567890');
    });
  });

  describe('POST /logout', () => {
    test('should require API key', async () => {
      const res = await request(app).post('/api/v1/logout');

      expect(res.status).toBe(401);
    });

    test('should return error when not connected', async () => {
      const res = await request(app)
        .post('/api/v1/logout')
        .set('X-API-Key', apiKey);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Not connected');
    });
  });

  describe('GET /inbox', () => {
    beforeEach(() => {
      // Insert test messages
      for (let i = 0; i < 10; i++) {
        insertMessage(db, 'incoming', '123@s.whatsapp.net', `Message ${i}`, 'unread');
      }
    });

    test('should require API key', async () => {
      const res = await request(app).get('/api/v1/inbox');

      expect(res.status).toBe(401);
    });

    test('should return all unread messages', async () => {
      const res = await request(app)
        .get('/api/v1/inbox')
        .set('X-API-Key', apiKey);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(10);
    });
  });

  describe('POST /messages/:id/reply', () => {
    let messageId;

    beforeEach(() => {
      const result = insertMessage(db, 'incoming', '123@s.whatsapp.net', 'Hello', 'unread');
      messageId = result.lastInsertRowid;

      // Mock WhatsApp socket
      whatsappState.setConnected(true, '1234567890');
      whatsappState.setSock({
        sendMessage: jest.fn().mockResolvedValue({})
      });
    });

    test('should require API key', async () => {
      const res = await request(app)
        .post(`/api/v1/messages/${messageId}/reply`)
        .send({ message: 'Reply' });

      expect(res.status).toBe(401);
    });

    test('should require message field', async () => {
      const res = await request(app)
        .post(`/api/v1/messages/${messageId}/reply`)
        .set('X-API-Key', apiKey)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Message is required');
    });

    test('should return error for non-existent message', async () => {
      const res = await request(app)
        .post('/api/v1/messages/999/reply')
        .set('X-API-Key', apiKey)
        .send({ message: 'Reply' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Message not found');
    });

    test('should send reply successfully', async () => {
      const res = await request(app)
        .post(`/api/v1/messages/${messageId}/reply`)
        .set('X-API-Key', apiKey)
        .send({ message: 'Hi there!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(whatsappState.sock.sendMessage).toHaveBeenCalled();
    });
  });

  describe('PATCH /messages/:id/status', () => {
    let messageId;

    beforeEach(() => {
      const result = insertMessage(db, 'incoming', '123@s.whatsapp.net', 'Test', 'unread');
      messageId = result.lastInsertRowid;
    });

    test('should require API key', async () => {
      const res = await request(app)
        .patch(`/api/v1/messages/${messageId}/status`)
        .send({ status: 'replied' });

      expect(res.status).toBe(401);
    });

    test('should require status field', async () => {
      const res = await request(app)
        .patch(`/api/v1/messages/${messageId}/status`)
        .set('X-API-Key', apiKey)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Status is required');
    });

    test('should reject invalid status', async () => {
      const res = await request(app)
        .patch(`/api/v1/messages/${messageId}/status`)
        .set('X-API-Key', apiKey)
        .send({ status: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid status');
    });

    test('should update status successfully', async () => {
      const res = await request(app)
        .patch(`/api/v1/messages/${messageId}/status`)
        .set('X-API-Key', apiKey)
        .send({ status: 'replied' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('should return error for non-existent message', async () => {
      const res = await request(app)
        .patch('/api/v1/messages/999/status')
        .set('X-API-Key', apiKey)
        .send({ status: 'replied' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Message not found');
    });
  });
});
