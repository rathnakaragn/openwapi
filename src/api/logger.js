const pino = require('pino');

/**
 * Create logger instance with environment-based configuration
 * @param {object} config - Configuration object
 * @returns {object} Pino logger instance
 */
function createLogger(config) {
  return pino({
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    transport: config.NODE_ENV !== 'production' ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    } : undefined
  });
}

module.exports = { createLogger };
