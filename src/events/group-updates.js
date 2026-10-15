/**
 * events/group-updates.js — Group participant update event handler.
 *
 * Handles:
 *  - Welcome messages when members join
 *  - Goodbye messages when members leave
 *  - Participant update events from groupParticipantsUpdate
 */

import { getGroupSettings } from '../services/settings.js';
import { normaliseJid } from '../services/permissions.js';
import logger from '../services/logger.js';

/**
 * Attach group participant update handler to the socket.
 * @param {object} sock - Baileys socket instance
 */
export function attachGroupUpdateHandler(sock) {
  sock.ev.on('group-participants.update', async (update) => {
    try {
      const { id: groupJid, participants, action } = update;

      if (!groupJid || !participants?.length) return;

      const gs = await getGroupSettings(groupJid);

      for (const participantJid of participants) {
        const participant = normaliseJid(participantJid);

        if (action === 'add') {
          await handleJoin(sock, groupJid, participant, gs);
        } else if (action === 'remove') {
          await handleLeave(sock, groupJid, participant, gs);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in group-participants.update handler');
    }
  });
}

/* ── Join ─────────────────────────────────────────────────────────────── */

async function handleJoin(sock, groupJid, participantJid, gs) {
  if (!gs.welcome.enabled) return;

  try {
    const meta = await sock.groupMetadata(groupJid).catch(() => null);
    const groupName = meta?.subject ?? 'this group';
    const count     = meta?.participants?.length ?? '?';

    const userNum = participantJid.split('@')[0];
    const msg = gs.welcome.message
      .replace('{user}',  `@${userNum}`)
      .replace('{group}', groupName)
      .replace('{count}', String(count));

    await sock.sendMessage(groupJid, {
      text:     msg,
      mentions: [participantJid],
    });
  } catch (err) {
    logger.warn({ err, groupJid, participantJid }, 'Failed to send welcome message');
  }
}

/* ── Leave ────────────────────────────────────────────────────────────── */

async function handleLeave(sock, groupJid, participantJid, gs) {
  if (!gs.goodbye.enabled) return;

  try {
    const meta = await sock.groupMetadata(groupJid).catch(() => null);
    const groupName = meta?.subject ?? 'this group';

    const userNum = participantJid.split('@')[0];
    const msg = gs.goodbye.message
      .replace('{user}',  `@${userNum}`)
      .replace('{group}', groupName);

    await sock.sendMessage(groupJid, {
      text:     msg,
      mentions: [participantJid],
    });
  } catch (err) {
    logger.warn({ err, groupJid, participantJid }, 'Failed to send goodbye message');
  }
}
