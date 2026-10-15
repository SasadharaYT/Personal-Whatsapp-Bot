/**
 * connection.js — Robust WhatsApp connection manager.
 *
 * Responsibilities:
 *  - Create and manage the Baileys socket instance
 *  - Handle QR / pairing-code authentication
 *  - Exponential backoff with jitter for reconnections
 *  - Prevent simultaneous instances and duplicate event listeners
 *  - Graceful shutdown on SIGINT / SIGTERM
 *  - Never delete auth files on failure
 */

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom }   from '@hapi/boom';
import pino       from 'pino';
import fs         from 'fs';
import config     from './config.js';
import logger     from './services/logger.js';
import { buildConnectionHandler }  from './events/connection.js';
import { attachMessageHandler }    from './events/messages.js';
import { attachGroupUpdateHandler } from './events/group-updates.js';
import { loadCommands }            from './handler.js';

/* ── Connection Manager ─────────────────────────────────────────────────── */

const manager = {
  socket:             null,
  saveCreds:          null,
  reconnectAttempts:  0,
  isShuttingDown:     false,

  /**
   * Initialise and start the WhatsApp socket.
   * Safe to call multiple times — cleans up the previous socket first.
   */
  async start() {
    if (this.isShuttingDown) return;
    if (this.socket) {
      // Remove all listeners before replacing
      this.socket.ev.removeAllListeners();
      try { await this.socket.ws?.close(); } catch { /* ignore */ }
      this.socket = null;
    }

    // Ensure auth directory exists
    fs.mkdirSync(config.authDir, { recursive: true });

    // Load persistent auth state
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    this.saveCreds = saveCreds;

    // Fetch latest supported WA Web version
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info({ version: version.join('.'), isLatest }, 'Using WhatsApp Web version');

    // Silent pino logger for Baileys internals (avoid credential leakage)
    const internalLogger = pino({ level: 'silent' });

    this.isRegistered = Boolean(state.creds?.registered);

    // Create socket
    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, internalLogger),
      },
      browser:           Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      logger:            internalLogger,
      markOnlineOnConnect: config.markOnline,
      getMessage: async () => undefined, // Implement if you maintain a message store
    });

    this.socket = sock;

    // ── Event listeners ──────────────────────────────────────────────────

    // Save credentials on every update
    sock.ev.on('creds.update', async () => {
      await saveCreds();
      this.isRegistered = Boolean(state.creds?.registered);
    });

    // Connection state changes
    sock.ev.on('connection.update', buildConnectionHandler(this));

    // Messages
    attachMessageHandler(sock);

    // Group participant changes (welcome/goodbye)
    attachGroupUpdateHandler(sock);

    // ── Pairing code flow ────────────────────────────────────────────────
    if (config.usePairingCode && !state.creds?.registered) {
      if (!config.pairingPhoneNumber) {
        logger.error('PAIRING_PHONE_NUMBER must be set when USE_PAIRING_CODE=true');
        process.exit(1);
      }
      let pairingRequested = false;
      sock.ev.on('connection.update', async (update) => {
        if (update.qr && !pairingRequested) {
          pairingRequested = true;
          await new Promise(resolve => setTimeout(resolve, 1000));
          try {
            const code = await sock.requestPairingCode(config.pairingPhoneNumber);
            const formatted = code.match(/.{1,4}/g)?.join('-') ?? code;
            logger.info(
              `\n${'═'.repeat(45)}\n` +
              `🔑  PAIRING CODE: ${formatted}\n` +
              `${'═'.repeat(45)}\n` +
              `Open WhatsApp > Linked Devices > Link with phone number and enter this code.\n`
            );
          } catch (err) {
            logger.error({ err }, 'Failed to request pairing code');
            pairingRequested = false;
          }
        }
      });
    }

    logger.info('Socket initialised and event listeners attached.');
  },

  /**
   * Reconnect with exponential backoff + jitter.
   * Stops after config.maxReconnectAttempts (0 = unlimited).
   */
  async reconnect(statusCode) {
    if (this.isShuttingDown) return;

    this.reconnectAttempts++;
    const max = config.maxReconnectAttempts;

    if (max > 0 && this.reconnectAttempts > max) {
      logger.error(`Max reconnect attempts (${max}) reached. Exiting.`);
      process.exit(1);
    }

    // Exponential backoff: base 2s, max 60s, + up to 3s jitter
    const base    = Math.min(2000 * Math.pow(2, this.reconnectAttempts - 1), 60_000);
    const jitter  = Math.random() * 3000;
    const delay   = Math.round(base + jitter);

    logger.info(
      `Reconnecting in ${(delay / 1000).toFixed(1)}s ` +
      `(attempt ${this.reconnectAttempts}${max ? '/' + max : ''})…`
    );

    await new Promise(r => setTimeout(r, delay));
    await this.start();
  },

  /**
   * Graceful shutdown: close socket, flush credentials.
   */
  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    logger.info('Graceful shutdown initiated…');
    try {
      if (this.socket) {
        this.socket.ev.removeAllListeners();
        await this.socket.logout().catch(() => {});
        this.socket = null;
      }
    } catch (err) {
      logger.warn({ err }, 'Error during shutdown');
    }
    logger.info('Bot stopped.');
    process.exit(0);
  },
};

/* ── Bootstrap ──────────────────────────────────────────────────────────── */

/**
 * Start the connection manager.
 * Loads commands, then starts the socket.
 */
export async function startConnection() {
  await loadCommands();
  await manager.start();

  // Graceful shutdown handlers
  process.once('SIGINT',  () => manager.shutdown());
  process.once('SIGTERM', () => manager.shutdown());

  // Catch unhandled promise rejections
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'Unhandled promise rejection');
  });
}

export { manager };
