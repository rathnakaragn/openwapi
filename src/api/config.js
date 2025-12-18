require('dotenv').config();

/**
 * Load and validate configuration from environment variables
 * @returns {object} Configuration object
 */
function loadConfig() {
  return {
    PORT: process.env.PORT || 3001,
    DASHBOARD_USER: process.env.DASHBOARD_USER || 'admin',
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD || 'admin123',
    DB_PATH: process.env.DB_PATH || './messages.db',
    SESSION_PATH: process.env.SESSION_PATH || './session',
    MEDIA_PATH: process.env.MEDIA_PATH || './media',
    NODE_ENV: process.env.NODE_ENV || 'development'
  };
}

module.exports = { loadConfig };
