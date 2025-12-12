const Database = require('better-sqlite3');
const {
  initializeDatabase,
  insertMessage,
  getMessages,
  getMessageById,
  updateMessageStatus,
  getMessageCount,
  getApiKey,
  ensureApiKey,
  getSetting,
  setSetting
} = require('../src/database');

describe('Database Operations', () => {
  let db;

  beforeEach(() => {
    // Create in-memory database for each test
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
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('insertMessage', () => {
    test('should insert incoming message', () => {
      const result = insertMessage(db, 'incoming', '1234567890@s.whatsapp.net', 'Hello', 'unread');
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeDefined();
    });

    test('should insert outgoing message', () => {
      const result = insertMessage(db, 'outgoing', '1234567890@s.whatsapp.net', 'Hi there', 'sent');
      expect(result.changes).toBe(1);
    });
  });

  describe('getMessages', () => {
    beforeEach(() => {
      // Insert test messages
      for (let i = 0; i < 10; i++) {
        insertMessage(db, 'incoming', '123@s.whatsapp.net', `Message ${i}`, 'unread');
      }
    });

    test('should get first page of messages', () => {
      const messages = getMessages(db, 1, 5);
      expect(messages).toHaveLength(5);
      expect(messages[0].message).toContain('Message');
    });

    test('should get second page of messages', () => {
      const messages = getMessages(db, 2, 5);
      expect(messages).toHaveLength(5);
    });

    test('should return empty array for page beyond data', () => {
      const messages = getMessages(db, 10, 5);
      expect(messages).toHaveLength(0);
    });
  });

  describe('getMessageById', () => {
    test('should return message by ID', () => {
      const insert = insertMessage(db, 'incoming', '123@s.whatsapp.net', 'Test message', 'unread');
      const message = getMessageById(db, insert.lastInsertRowid);
      expect(message).toBeDefined();
      expect(message.message).toBe('Test message');
      expect(message.phone).toBe('123@s.whatsapp.net');
    });

    test('should return undefined for non-existent ID', () => {
      const message = getMessageById(db, 999);
      expect(message).toBeUndefined();
    });
  });

  describe('updateMessageStatus', () => {
    test('should update message status', () => {
      const insert = insertMessage(db, 'incoming', '123@s.whatsapp.net', 'Test', 'unread');
      const result = updateMessageStatus(db, insert.lastInsertRowid, 'replied');
      expect(result.changes).toBe(1);

      const message = getMessageById(db, insert.lastInsertRowid);
      expect(message.reply_status).toBe('replied');
    });

    test('should return 0 changes for non-existent ID', () => {
      const result = updateMessageStatus(db, 999, 'replied');
      expect(result.changes).toBe(0);
    });
  });

  describe('getMessageCount', () => {
    test('should return 0 for empty database', () => {
      const count = getMessageCount(db);
      expect(count).toBe(0);
    });

    test('should return correct count (incoming only)', () => {
      insertMessage(db, 'incoming', '123@s.whatsapp.net', 'Test 1', 'unread');
      insertMessage(db, 'incoming', '123@s.whatsapp.net', 'Test 2', 'unread');
      insertMessage(db, 'outgoing', '123@s.whatsapp.net', 'Reply', 'sent');

      const count = getMessageCount(db);
      expect(count).toBe(2); // Only counts incoming messages
    });
  });

  describe('API Key Management', () => {
    test('should return undefined when no API key exists', () => {
      const key = getApiKey(db);
      expect(key).toBeUndefined();
    });

    test('should generate and store API key', () => {
      const key = ensureApiKey(db);
      expect(key).toBeDefined();
      expect(key.length).toBeGreaterThan(0);

      const stored = getApiKey(db);
      expect(stored.key).toBe(key);
    });

    test('should return existing API key', () => {
      const key1 = ensureApiKey(db);
      const key2 = ensureApiKey(db);
      expect(key1).toBe(key2);
    });
  });

  describe('Settings', () => {
    test('should store and retrieve setting', () => {
      setSetting(db, 'version', '1.0.0');
      const value = getSetting(db, 'version');
      expect(value).toBe('1.0.0');
    });

    test('should return null for non-existent setting', () => {
      const value = getSetting(db, 'nonexistent');
      expect(value).toBeNull();
    });

    test('should update existing setting', () => {
      setSetting(db, 'version', '1.0.0');
      setSetting(db, 'version', '1.0.1');
      const value = getSetting(db, 'version');
      expect(value).toBe('1.0.1');
    });
  });
});
