/**
 * events/connection.js — Connection state event handler.
 *
 * Handles: open, close, QR, credential updates.
 * Wired by connection.js — not called directly.
 */

import { DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import config from '../config.js';
import logger from '../services/logger.js';

/**
 * Build and return a connection.update handler for the given socket manager.
 *
 * @param {object} manager - The connection manager object from connection.js
 *                           Must expose: { reconnect(), socket }
 */
export function buildConnectionHandler(manager) {
  return async function onConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !config.usePairingCode) {
      logger.info('Scan this QR code with WhatsApp on your phone:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      manager.reconnectAttempts = 0;
      logger.info('✅ WhatsApp connection established.');
    }

    if (connection === 'close') {
      const err        = lastDisconnect?.error;
      const statusCode = err instanceof Boom ? err.output?.statusCode : null;
      const reason     = DisconnectReason[statusCode] ?? `code ${statusCode}`;

      logger.warn({ statusCode, reason }, 'Connection closed');

      const permanent = [
        DisconnectReason.loggedOut,
        DisconnectReason.badSession,
        DisconnectReason.forbidden,
      ].includes(statusCode);

      if (permanent && manager.isRegistered) {
        logger.error(
          `Permanent disconnect (${reason}). ` +
          'Delete the auth/ directory and re-scan the QR code to re-authenticate.'
        );
        // DO NOT delete auth files automatically — preserve creds for investigation
        process.exit(1);
      }

      // Retryable failure — let the manager handle exponential backoff
      await manager.reconnect(statusCode);
    }
  };
}
