const Database = require('better-sqlite3');
const crypto = require('crypto');

/**
 * Initialize SQLite database with WAL mode
 * @param {string} dbPath - Path to database file
 * @returns {Database} Database instance
 */
function initializeDatabase(dbPath = './messages.db') {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      phone TEXT NOT NULL,
      sender_name TEXT,
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

    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      event TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: Add sender_name column if it doesn't exist
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }

  return db;
}

/**
 * Get current timestamp in IST (24-hour format)
 * @returns {string} Timestamp in format 'YYYY-MM-DD HH:MM:SS'
 */
function getISTTimestamp() {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);

  const year = istTime.getUTCFullYear();
  const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istTime.getUTCDate()).padStart(2, '0');
  const hours = String(istTime.getUTCHours()).padStart(2, '0');
  const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(istTime.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Insert a new message into the database
 * @param {Database} db - Database instance
 * @param {string} direction - 'incoming' or 'outgoing'
 * @param {string} phone - Phone number with WhatsApp suffix
 * @param {string} message - Message text
 * @param {string} status - Message status
 * @param {string|null} mediaType - Type of media ('image', etc.) or null
 * @param {string|null} mediaUrl - Path to media file or URL, or null
 * @param {string|null} senderName - Sender's display name (pushName)
 * @returns {object} Insert result
 */
function insertMessage(db, direction, phone, message, status = 'unread', mediaType = null, mediaUrl = null, senderName = null) {
  const timestamp = getISTTimestamp();
  const stmt = db.prepare(`
    INSERT INTO messages (direction, phone, sender_name, message, reply_status, media_type, media_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(direction, phone, senderName, message, status, mediaType, mediaUrl, timestamp);
}

/**
 * Get messages with pagination
 * @param {Database} db - Database instance
 * @param {number} page - Page number (starts at 1)
 * @param {number} limit - Messages per page
 * @returns {Array} Array of messages
 */
function getMessages(db, page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const stmt = db.prepare(`
    SELECT * FROM messages
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(limit, offset);
}

/**
 * Get a single message by ID
 * @param {Database} db - Database instance
 * @param {number} id - Message ID
 * @returns {object|null} Message object or null
 */
function getMessageById(db, id) {
  const stmt = db.prepare(`
    SELECT * FROM messages WHERE id = ?
  `);
  return stmt.get(id);
}

/**
 * Update message status
 * @param {Database} db - Database instance
 * @param {number} id - Message ID
 * @param {string} status - New status
 * @returns {object} Update result
 */
function updateMessageStatus(db, id, status) {
  const stmt = db.prepare(`
    UPDATE messages
    SET reply_status = ?
    WHERE id = ?
  `);
  return stmt.run(status, id);
}

/**
 * Get total message count
 * @param {Database} db - Database instance
 * @returns {number} Total message count
 */
function getMessageCount(db) {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM messages WHERE direction = 'incoming'
  `);
  return stmt.get().count;
}

/**
 * Get API key from database
 * @param {Database} db - Database instance
 * @returns {object|null} API key object or null
 */
function getApiKey(db) {
  const stmt = db.prepare(`
    SELECT key FROM api_keys
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return stmt.get();
}

/**
 * Ensure API key exists, generate if not
 * @param {Database} db - Database instance
 * @returns {string} API key
 */
function ensureApiKey(db) {
  const existingKey = getApiKey(db);

  if (existingKey) {
    return existingKey.key;
  }

  // Generate new 32-byte random key
  const randomBytes = crypto.randomBytes(32);
  const apiKey = randomBytes.toString('base64');

  // Store in database
  const stmt = db.prepare(`
    INSERT INTO api_keys (key) VALUES (?)
  `);
  stmt.run(apiKey);

  return apiKey;
}

/**
 * Get setting value by key
 * @param {Database} db - Database instance
 * @param {string} key - Setting key
 * @returns {string|null} Setting value or null
 */
function getSetting(db, key) {
  const stmt = db.prepare(`
    SELECT value FROM settings WHERE key = ?
  `);
  const result = stmt.get(key);
  return result ? result.value : null;
}

/**
 * Set setting value
 * @param {Database} db - Database instance
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 */
function setSetting(db, key, value) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
  `);
  stmt.run(key, value);
}

/**
 * Get webhook by event
 * @param {Database} db - Database instance
 * @param {string} event - Event name
 * @returns {object|null} Webhook object or null
 */
function getWebhook(db, event = 'message.received') {
  const stmt = db.prepare(`
    SELECT * FROM webhooks WHERE event = ? AND active = 1 LIMIT 1
  `);
  return stmt.get(event);
}

/**
 * Set webhook URL
 * @param {Database} db - Database instance
 * @param {string} url - Webhook URL
 * @param {string} event - Event name
 */
function setWebhook(db, url, event = 'message.received') {
  // Delete existing webhook for this event
  db.prepare(`DELETE FROM webhooks WHERE event = ?`).run(event);

  // Insert new webhook
  const stmt = db.prepare(`
    INSERT INTO webhooks (url, event) VALUES (?, ?)
  `);
  stmt.run(url, event);
}

/**
 * Delete webhook
 * @param {Database} db - Database instance
 * @param {string} event - Event name
 */
function deleteWebhook(db, event = 'message.received') {
  const stmt = db.prepare(`DELETE FROM webhooks WHERE event = ?`);
  stmt.run(event);
}

module.exports = {
  initializeDatabase,
  insertMessage,
  getMessages,
  getMessageById,
  updateMessageStatus,
  getMessageCount,
  getApiKey,
  ensureApiKey,
  getSetting,
  setSetting,
  getWebhook,
  setWebhook,
  deleteWebhook
};
