/**
 * events/messages.js — Incoming message event handler.
 *
 * Wires the messages.upsert event to the command handler.
 * Also runs anti-link checks before dispatching commands.
 */

import { handleMessage } from '../handler.js';
import { checkAntiLink }  from './antilink.js';
import logger from '../services/logger.js';

/**
 * Attach the messages.upsert handler to the socket.
 * @param {object} sock - Baileys socket instance
 */
export function attachMessageHandler(sock) {
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Process real-time incoming messages ('notify') and companion/phone-sent messages ('append')
    if (type !== 'notify' && type !== 'append') return;

    for (const msg of messages) {
      try {
        if (!msg?.message) continue;

        // Skip history sync / protocol notifications
        if (
          msg.message.historySyncNotification ||
          msg.message.protocolMessage?.historySyncNotification
        ) {
          continue;
        }

        // For 'append' upserts, skip old messages (> 120s old) to avoid running stale history on reconnect
        if (type === 'append' && msg.messageTimestamp) {
          const ts = typeof msg.messageTimestamp === 'bigint'
            ? Number(msg.messageTimestamp)
            : Number(msg.messageTimestamp);
          const ageSeconds = (Date.now() / 1000) - ts;
          if (ageSeconds > 120) {
            continue;
          }
        }

        // Anti-link check runs first (may delete the message before command dispatch)
        await checkAntiLink(sock, msg);
        // Then dispatch to command handler
        await handleMessage(msg, sock);
      } catch (err) {
        logger.error({ err, msgId: msg?.key?.id }, 'Error processing message');
      }
    }
  });
}
