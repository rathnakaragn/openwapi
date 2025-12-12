/**
 * Global state management for WhatsApp connection
 */
class WhatsAppState {
  constructor() {
    this.sock = null;           // Baileys socket instance
    this.qrCode = null;          // Current QR code (base64)
    this.connected = false;      // Connection status
    this.phone = null;           // Connected phone number
    this.reconnectFn = null;     // Function to reconnect WhatsApp
  }

  /**
   * Set Baileys socket instance
   * @param {object} sock - Baileys socket
   */
  setSock(sock) {
    this.sock = sock;
  }

  /**
   * Set reconnect function
   * @param {Function} fn - Reconnect function
   */
  setReconnectFn(fn) {
    this.reconnectFn = fn;
  }

  /**
   * Set QR code for authentication
   * @param {string} qr - QR code as base64 data URL
   */
  setQrCode(qr) {
    this.qrCode = qr;
  }

  /**
   * Set connection status
   * @param {boolean} connected - Connection status
   * @param {string|null} phone - Phone number if connected
   */
  setConnected(connected, phone = null) {
    this.connected = connected;
    this.phone = phone;
  }

  /**
   * Get current status
   * @returns {object} Status object
   */
  getStatus() {
    return {
      connected: this.connected,
      phone: this.phone,
      hasQrCode: this.qrCode !== null
    };
  }
}

module.exports = { WhatsAppState };
