// tests/jest.setup.js — Set required environment variables before any module loads
// This runs before any test file and before any module imports are evaluated.

process.env.OWNER_NUMBERS = '94771234567';
process.env.BOT_NAME      = 'TestBot';
process.env.PREFIX        = '.';
process.env.LOG_LEVEL     = 'silent';
process.env.DATA_DIR      = 'data';
process.env.AUTH_DIR      = 'auth';
process.env.NODE_ENV      = 'test';
process.env.OLLAMA_API_KEY = 'test_ollama_key_123';
process.env.OLLAMA_MODEL = 'gemma4:31b-cloud';
process.env.PEXELS_API_KEY = 'test_pexels_key_123';
process.env.AI_ENABLED     = 'true';
process.env.MEDIA_ENABLED  = 'true';
process.env.TEMP_DIR       = 'temp_test';
