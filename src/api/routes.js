const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  getApiKey,
  getMessages,
  getMessageById,
  getMessageCount,
  updateMessageStatus,
  insertMessage,
  getWebhook,
  setWebhook,
  deleteWebhook
} = require('../database');

/**
 * Timing-safe string comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings match
 */
function timingSafeCompare(a, b) {
  if (!a || !b || a.length !== b.length) {
    return false;
  }

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * API Key authentication middleware
 * @param {object} database - Database instance
 * @returns {Function} Express middleware
 */
function authenticateApiKey(database) {
  return (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required'
      });
    }

    // Get API key from database
    const storedKey = getApiKey(database);

    if (!storedKey) {
      return res.status(500).json({
        success: false,
        error: 'API key not configured'
      });
    }

    // Timing-safe comparison
    const isValid = timingSafeCompare(apiKey, storedKey.key);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      });
    }

    next();
  };
}

/**
 * Basic authentication middleware for dashboard
 * @param {object} config - Configuration object
 * @returns {Function} Express middleware
 */
function authenticateBasicAuth(config) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard"');
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Decode credentials
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');

    // Timing-safe comparison
    const validUsername = timingSafeCompare(username, config.DASHBOARD_USER);
    const validPassword = timingSafeCompare(password, config.DASHBOARD_PASSWORD);

    if (!validUsername || !validPassword) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard"');
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    next();
  };
}

/**
 * Create Express router with all API endpoints
 * @param {object} database - Database instance
 * @param {object} whatsappState - WhatsApp state instance
 * @param {object} config - Configuration object
 * @param {object} logger - Logger instance
 * @returns {express.Router} Express router
 */
function createRoutes(database, whatsappState, config, logger) {
  const router = express.Router();

  // 1. Health Check (Public)
  router.get('/health', (req, res) => {
    res.json({
      success: true,
      message: 'WhatsApp API is running',
      version: '1.0.0'
    });
  });

  // 2. Get QR Code (Public)
  router.get('/qr', (req, res) => {
    const status = whatsappState.getStatus();

    // Already connected
    if (status.connected) {
      return res.status(400).json({
        success: false,
        error: 'Already connected to WhatsApp'
      });
    }

    // QR code available
    if (whatsappState.qrCode) {
      return res.json({
        success: true,
        data: {
          qr: whatsappState.qrCode,
          message: 'Scan this QR code with WhatsApp'
        }
      });
    }

    // QR code not ready
    res.status(400).json({
      success: false,
      error: 'QR code not available. Please restart the server.'
    });
  });

  // 3. Get Configuration (Basic Auth)
  router.get('/config', authenticateBasicAuth(config), (req, res) => {
    const apiKey = getApiKey(database);
    const status = whatsappState.getStatus();
    const messageCount = getMessageCount(database);

    res.json({
      success: true,
      data: {
        apiKey: apiKey ? apiKey.key : null,
        connected: status.connected,
        phone: status.phone,
        messageCount: messageCount
      }
    });
  });

  // 4. Get Status (API Key)
  router.get('/status', authenticateApiKey(database), (req, res) => {
    const status = whatsappState.getStatus();
    const messageCount = getMessageCount(database);

    res.json({
      success: true,
      data: {
        connected: status.connected,
        phone: status.phone,
        messageCount: messageCount
      }
    });
  });

  // 5. Logout (API Key)
  router.post('/logout', authenticateApiKey(database), async (req, res) => {
    if (!whatsappState.sock) {
      return res.status(400).json({
        success: false,
        error: 'Not connected'
      });
    }

    try {
      // Logout from WhatsApp
      await whatsappState.sock.logout();

      // Update state
      whatsappState.setConnected(false, null);
      whatsappState.setSock(null);

      // Delete session folder to ensure clean logout
      const sessionPath = path.resolve(config.SESSION_PATH);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        logger.info('Session folder deleted');
      }

      // Trigger reconnection to generate new QR code
      if (whatsappState.reconnectFn) {
        logger.info('Triggering reconnection for new QR code...');
        setTimeout(() => whatsappState.reconnectFn(), 3000);
      }

      logger.info('Logged out successfully');

      res.json({
        success: true,
        message: 'Logged out successfully. Reconnecting to generate new QR code...'
      });
    } catch (error) {
      logger.error('Logout error:', error);
      res.status(500).json({
        success: false,
        error: 'Logout failed'
      });
    }
  });

  // 6. Get Inbox (API Key)
  router.get('/inbox', authenticateApiKey(database), (req, res) => {
    try {
      // Get all unread incoming messages
      const stmt = database.prepare(`
        SELECT
          id,
          direction as type,
          phone,
          message,
          reply_status as status,
          media_type,
          media_url,
          created_at as timestamp
        FROM messages
        WHERE direction = 'incoming' AND reply_status = 'unread'
        ORDER BY created_at DESC
      `);
      const messages = stmt.all();

      res.json({
        success: true,
        data: messages
      });
    } catch (error) {
      logger.error('Failed to get inbox:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve messages'
      });
    }
  });

  // 7. Reply to Message (API Key)
  // Supports text-only, image-only, or text+image
  // Image can be base64 string or URL
  router.post('/messages/:id/reply', authenticateApiKey(database), async (req, res) => {
    const { message, image } = req.body;
    const messageId = req.params.id;

    // Validation - at least message or image required
    if (!message && !image) {
      return res.status(400).json({
        success: false,
        error: 'Message or image is required'
      });
    }

    // Check connection
    if (!whatsappState.connected || !whatsappState.sock) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp not connected'
      });
    }

    // Get original message
    const originalMessage = getMessageById(database, messageId);

    if (!originalMessage) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    try {
      let mediaType = 'text';
      let mediaUrl = null;

      if (image) {
        // Determine if image is URL or base64
        let imageContent;
        if (image.startsWith('http://') || image.startsWith('https://')) {
          imageContent = { url: image };
          mediaUrl = image;
        } else {
          // Assume base64
          imageContent = Buffer.from(image, 'base64');
          mediaUrl = 'base64';
        }

        mediaType = 'image';

        // Send image reply via Baileys
        await whatsappState.sock.sendMessage(
          originalMessage.phone,
          {
            image: imageContent,
            caption: message || ''
          }
        );
      } else {
        // Send text-only reply via Baileys
        await whatsappState.sock.sendMessage(
          originalMessage.phone,
          { text: message }
        );
      }

      // Store outgoing message
      insertMessage(database, 'outgoing', originalMessage.phone, message || '', 'sent', mediaType, mediaUrl);

      // Update original message status
      updateMessageStatus(database, messageId, 'replied');

      logger.info('Reply sent', { messageId, to: originalMessage.phone, type: mediaType || 'text' });

      res.json({
        success: true,
        message: 'Reply sent successfully'
      });
    } catch (error) {
      logger.error('Reply error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send reply'
      });
    }
  });

  // 8. Update Message Status (API Key)
  router.patch('/messages/:id/status', authenticateApiKey(database), (req, res) => {
    const { status } = req.body;
    const messageId = req.params.id;

    // Validation
    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required'
      });
    }

    const validStatuses = ['unread', 'replied', 'ignored', 'sent'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be one of: unread, replied, ignored, sent'
      });
    }

    try {
      // Update status
      const result = updateMessageStatus(database, messageId, status);

      if (result.changes === 0) {
        return res.status(404).json({
          success: false,
          error: 'Message not found'
        });
      }

      logger.info('Message status updated', { messageId, status });

      res.json({
        success: true,
        message: 'Status updated successfully'
      });
    } catch (error) {
      logger.error('Failed to update status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update status'
      });
    }
  });

  // 9. Get Webhook (Basic Auth)
  router.get('/webhook', authenticateBasicAuth(config), (req, res) => {
    try {
      const webhook = getWebhook(database, 'message.received');

      res.json({
        success: true,
        data: webhook || null
      });
    } catch (error) {
      logger.error('Failed to get webhook:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve webhook'
      });
    }
  });

  // 10. Set Webhook (Basic Auth)
  router.post('/webhook', authenticateBasicAuth(config), (req, res) => {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Webhook URL is required'
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }

    try {
      setWebhook(database, url, 'message.received');
      logger.info('Webhook configured', { url });

      res.json({
        success: true,
        message: 'Webhook configured successfully'
      });
    } catch (error) {
      logger.error('Failed to set webhook:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to configure webhook'
      });
    }
  });

  // 11. Delete Webhook (Basic Auth)
  router.delete('/webhook', authenticateBasicAuth(config), (req, res) => {
    try {
      deleteWebhook(database, 'message.received');
      logger.info('Webhook deleted');

      res.json({
        success: true,
        message: 'Webhook deleted successfully'
      });
    } catch (error) {
      logger.error('Failed to delete webhook:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete webhook'
      });
    }
  });

  return router;
}

module.exports = { createRoutes };
