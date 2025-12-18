const express = require('express');
const path = require('path');
const { initializeDatabase, ensureApiKey } = require('./src/database');
const { initializeWhatsApp } = require('./src/api/whatsapp');
const { createRoutes } = require('./src/api/routes');
const { loadConfig } = require('./src/api/config');
const { createLogger } = require('./src/api/logger');

// Load configuration
const config = loadConfig();
const logger = createLogger(config);

logger.info('='.repeat(50));
logger.info('Starting OpenWAPI v1.0');
logger.info('='.repeat(50));

// Initialize Express
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve images from media folder
app.use('/image', express.static(path.resolve(config.MEDIA_PATH)));

// Initialize database
logger.info('Initializing database...');
const database = initializeDatabase(config.DB_PATH);
logger.info('Database initialized');

// Ensure API key exists
const apiKey = ensureApiKey(database);
logger.info('='.repeat(50));
logger.info('API Key:', apiKey);
logger.info('='.repeat(50));
logger.info('Dashboard credentials:');
logger.info('  Username:', config.DASHBOARD_USER);
logger.info('  Password:', config.DASHBOARD_PASSWORD);
logger.info('='.repeat(50));

// Initialize WhatsApp client
logger.info('Initializing WhatsApp client...');
initializeWhatsApp(database, logger, config.SESSION_PATH, config.MEDIA_PATH).then((whatsappState) => {
  logger.info('WhatsApp client initialized');

  // Create API routes
  const routes = createRoutes(database, whatsappState, config, logger);
  app.use('/api/v1', routes);

  // Start server
  app.listen(config.PORT, () => {
    logger.info('='.repeat(50));
    logger.info(`Server running on port ${config.PORT}`);
    logger.info(`Dashboard: http://localhost:${config.PORT}/login.html`);
    logger.info(`API Base: http://localhost:${config.PORT}/api/v1`);
    logger.info('='.repeat(50));
  });
}).catch((error) => {
  logger.error('Failed to initialize WhatsApp client:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  database.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down gracefully...');
  database.close();
  process.exit(0);
});
