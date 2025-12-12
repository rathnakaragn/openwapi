const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const { WhatsAppState } = require('./state');
const { insertMessage, getWebhook } = require('../database');

/**
 * Call webhook with message data
 * @param {string} url - Webhook URL
 * @param {object} data - Data to send
 * @param {object} logger - Logger instance
 */
async function callWebhook(url, data, logger) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    if (!response.ok) {
      logger.warn('Webhook call failed', { url, status: response.status });
    } else {
      logger.info('Webhook called successfully', { url });
    }
  } catch (error) {
    logger.error('Webhook error', { url, error: error.message });
  }
}

/**
 * Initialize WhatsApp client with Baileys
 * @param {object} database - Database instance
 * @param {object} logger - Logger instance
 * @param {string} sessionPath - Path to session storage
 * @returns {Promise<WhatsAppState>} WhatsApp state instance
 */
async function initializeWhatsApp(database, logger, sessionPath = './session') {
  const whatsappState = new WhatsAppState();

  // Load auth state from session
  let authState = await useMultiFileAuthState(sessionPath);

  async function connectToWhatsApp() {
    // Reload auth state to pick up any changes (e.g., after logout/session deletion)
    authState = await useMultiFileAuthState(sessionPath);
    // Create a silent logger for Baileys to prevent noise
    const baileysLogger = {
      level: 'silent',
      fatal: () => {},
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
      trace: () => {},
      child: () => baileysLogger
    };

    const sock = makeWASocket({
      auth: authState.state,
      printQRInTerminal: false,
      logger: baileysLogger
    });

    whatsappState.setSock(sock);

    // QR code and connection events
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Generate QR code as base64 image
        try {
          const qrDataUrl = await QRCode.toDataURL(qr);
          whatsappState.setQrCode(qrDataUrl);
          logger.info('QR code generated');
        } catch (error) {
          logger.error('Failed to generate QR code:', error);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        logger.info('Connection closed', { shouldReconnect });
        whatsappState.setConnected(false, null);

        if (shouldReconnect) {
          logger.info('Reconnecting in 5 seconds...');
          setTimeout(connectToWhatsApp, 5000);
        } else {
          logger.info('Logged out. QR scan required.');
          whatsappState.setQrCode(null);
          // Allow manual reconnection after logout
          setTimeout(() => {
            logger.info('Reconnecting to generate QR code...');
            connectToWhatsApp();
          }, 2000);
        }
      } else if (connection === 'open') {
        logger.info('WhatsApp connected');
        const phone = sock.user?.id.split(':')[0];
        whatsappState.setConnected(true, phone);
        whatsappState.setQrCode(null);
        logger.info('Connected phone:', phone);
      }
    });

    // Save credentials on update
    sock.ev.on('creds.update', authState.saveCreds);

    // Message received event
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;

        const from = msg.key.remoteJid;

        // Extract text from various message types
        const text = msg.message.conversation ||
                    msg.message.extendedTextMessage?.text ||
                    '';

        // Only store incoming messages (not from us)
        if (text && !msg.key.fromMe) {
          try {
            const result = insertMessage(database, 'incoming', from, text, 'unread');
            const messageId = result.lastInsertRowid;

            logger.info('Message received', {
              from,
              preview: text.substring(0, 50) + (text.length > 50 ? '...' : '')
            });

            // Call webhook if configured
            const webhook = getWebhook(database, 'message.received');
            if (webhook && webhook.url) {
              callWebhook(webhook.url, {
                event: 'message.received',
                message: {
                  id: messageId,
                  from: from,
                  text: text,
                  timestamp: new Date().toISOString()
                }
              }, logger);
            }
          } catch (error) {
            logger.error('Failed to store message:', error);
          }
        }
      }
    });
  }

  // Store reconnect function in state for manual reconnection (e.g., after logout)
  whatsappState.setReconnectFn(connectToWhatsApp);

  // Initial connection
  await connectToWhatsApp();

  return whatsappState;
}

module.exports = { initializeWhatsApp };
