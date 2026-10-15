// tests/jest.setup.js — Set required environment variables before any module loads
// This runs before any test file and before any module imports are evaluated.

process.env.OWNER_NUMBERS = '94771234567';
process.env.BOT_NAME      = 'TestBot';
process.env.PREFIX        = '.';
process.env.LOG_LEVEL     = 'silent';
process.env.DATA_DIR      = 'data';
process.env.AUTH_DIR      = 'auth';
process.env.NODE_ENV      = 'test';
