const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
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
 * @param {string} mediaPath - Path to media storage
 * @returns {Promise<WhatsAppState>} WhatsApp state instance
 */
async function initializeWhatsApp(database, logger, sessionPath = './session', mediaPath = './media') {
  const whatsappState = new WhatsAppState();

  // Ensure media directory exists
  const resolvedMediaPath = path.resolve(mediaPath);
  if (!fs.existsSync(resolvedMediaPath)) {
    fs.mkdirSync(resolvedMediaPath, { recursive: true });
    logger.info('Created media directory:', resolvedMediaPath);
  }

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

        // Try to get the real phone number from various sources
        let from = msg.key.remoteJid;

        // If remoteJid is a LID, try to get real number from participant
        if (from && from.endsWith('@lid')) {
          logger.info('LID message detected', {
            remoteJid: from,
            participant: msg.key.participant,
            pushName: msg.pushName
          });

          // Check participant (used in groups, sometimes has real number)
          if (msg.key.participant && msg.key.participant.includes('@s.whatsapp.net')) {
            from = msg.key.participant;
          }
        }

        // Check for image message
        const imageMessage = msg.message.imageMessage;

        // Extract text from various message types (including image caption)
        const text = msg.message.conversation ||
                    msg.message.extendedTextMessage?.text ||
                    imageMessage?.caption ||
                    '';

        // Only store incoming messages (not from us)
        if (!msg.key.fromMe && (text || imageMessage)) {
          try {
            let mediaType = 'text';
            let mediaUrl = null;
            let imageBuffer = null;

            // Download image first if present
            if (imageMessage) {
              try {
                imageBuffer = await downloadMediaMessage(
                  msg,
                  'buffer',
                  {},
                  {
                    logger,
                    reuploadRequest: sock.updateMediaMessage
                  }
                );
                mediaType = 'image';
              } catch (downloadError) {
                logger.error('Failed to download image:', downloadError);
              }
            }

            // Insert message to get the ID (include sender's display name)
            const senderName = msg.pushName || null;
            const result = insertMessage(database, 'incoming', from, text, 'unread', mediaType, null, senderName);
            const messageId = result.lastInsertRowid;

            // Save image using message ID as filename
            if (imageBuffer) {
              const filename = `${messageId}.jpg`;
              const filepath = path.join(resolvedMediaPath, filename);
              fs.writeFileSync(filepath, imageBuffer);
              mediaUrl = filename;  // Store only filename, not full path

              // Update message with media URL
              database.prepare('UPDATE messages SET media_url = ? WHERE id = ?').run(mediaUrl, messageId);

              logger.info('Image downloaded', {
                from,
                messageId,
                size: imageBuffer.length,
                path: filepath
              });
            }

            logger.info('Message received', {
              from,
              type: mediaType || 'text',
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
                  mediaType: mediaType,
                  mediaUrl: mediaUrl,
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
