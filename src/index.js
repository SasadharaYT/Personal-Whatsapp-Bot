/**
 * src/index.js — Application entry point.
 *
 * Validates environment, then starts the WhatsApp connection.
 */

import 'dotenv/config';
import logger from './services/logger.js';
import { startConnection } from './connection.js';

// Config is validated at import time — any missing required fields will throw here.
import config from './config.js';

/* ── Startup banner ─────────────────────────────────────────────────────── */

logger.info(`
╔══════════════════════════════════════╗
║  🤖  ${(config.botName + ' v' + config.botVersion).padEnd(34)}║
║  Powered by @whiskeysockets/baileys  ║
╚══════════════════════════════════════╝

⚠️  WARNING: This bot uses the unofficial WhatsApp Web API.
    Using unofficial automation may result in account restrictions
    or bans by WhatsApp. Use at your own risk and responsibility.

🔑  Owner(s): ${config.ownerNumbers.map(j => j.split('@')[0]).join(', ')}
🌏  Timezone: ${config.timezone}
📁  Auth dir: ${config.authDir}
📂  Data dir: ${config.dataDir}
`);

/* ── Start ──────────────────────────────────────────────────────────────── */

startConnection().catch(err => {
  logger.fatal({ err }, 'Fatal error during startup');
  process.exit(1);
});
