// Mock for Baileys library
module.exports = {
  default: jest.fn(() => ({
    sendMessage: jest.fn().mockResolvedValue({}),
    logout: jest.fn().mockResolvedValue({}),
    ev: {
      on: jest.fn(),
      off: jest.fn()
    },
    user: {
      id: '1234567890:1@s.whatsapp.net'
    }
  })),
  useMultiFileAuthState: jest.fn().mockResolvedValue({
    state: {},
    saveCreds: jest.fn()
  }),
  DisconnectReason: {
    loggedOut: 'loggedOut',
    connectionClosed: 'connectionClosed',
    connectionLost: 'connectionLost'
  }
};
