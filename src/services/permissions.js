/**
 * permissions.js — Permission checking service.
 *
 * Provides helpers to check owner, admin, and group-membership status.
 * Always fetches live metadata from WhatsApp — never caches admin lists
 * across commands to prevent stale privilege escalation.
 */

import config from '../config.js';
import logger from './logger.js';
import { getGroupSettings, getBlockedUsers } from './settings.js';

/**
 * Normalise a JID to bare format.
 * "94771234567:12@s.whatsapp.net" → "94771234567@s.whatsapp.net"
 */
export function normaliseJid(jid = '') {
  if (!jid) return '';
  const str = typeof jid === 'string' ? jid : (jid?.id ?? jid?.jid ?? String(jid));
  if (typeof str !== 'string') return '';
  const server = str.includes('@') ? '@' + str.split('@')[1] : '@s.whatsapp.net';
  const bareUser = str.split('@')[0].split(':')[0];
  return bareUser + server;
}

/**
 * Check if a JID belongs to an owner.
 * Uses config.ownerNumbers, compares digits, and checks sock.user if provided.
 */
export function isOwner(jid) {
  if (!jid) return false;
  const norm = normaliseJid(jid);
  if (config.ownerNumbers.includes(norm)) return true;

  // Compare phone number digits in case server or formatting differed
  const digits = norm.replace(/\D/g, '');
  if (digits && config.ownerNumbers.some(o => o.replace(/\D/g, '') === digits)) {
    return true;
  }

  return false;
}

/**
 * Fetch live group metadata and return structured permission context.
 *
 * @param {object} sock   - Baileys socket instance
 * @param {string} groupJid - Group JID
 * @param {string} senderJid - Sender JID
 * @returns {{ metadata, isAdmin, isSuperAdmin, isBotAdmin, participants }}
 */
export async function getGroupPermissions(sock, groupJid, senderJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const senderNorm = normaliseJid(senderJid);
    const botJid = normaliseJid(sock.user?.id ?? '');

    const sender = metadata.participants.find(
      p => normaliseJid(p.id) === senderNorm
    );
    const bot = metadata.participants.find(
      p => normaliseJid(p.id) === botJid
    );

    return {
      metadata,
      participants: metadata.participants,
      isAdmin:      sender?.admin === 'admin' || sender?.admin === 'superadmin',
      isSuperAdmin: sender?.admin === 'superadmin',
      isBotAdmin:   bot?.admin   === 'admin' || bot?.admin === 'superadmin',
    };
  } catch (err) {
    logger.warn({ err, groupJid }, 'Failed to fetch group metadata');
    return {
      metadata:    null,
      participants: [],
      isAdmin:     false,
      isSuperAdmin:false,
      isBotAdmin:  false,
    };
  }
}

/**
 * Check whether a user is a group administrator (live check).
 */
export async function isGroupAdmin(sock, groupJid, userJid) {
  const { isAdmin } = await getGroupPermissions(sock, groupJid, userJid);
  return isAdmin;
}

/**
 * Check whether the bot itself has administrator privileges.
 */
export async function isBotGroupAdmin(sock, groupJid) {
  const { isBotAdmin } = await getGroupPermissions(sock, groupJid, sock.user?.id ?? '');
  return isBotAdmin;
}

/**
 * Check whether a sender is blocked.
 */
export async function isUserBlocked(jid) {
  const list = await getBlockedUsers();
  return list.includes(normaliseJid(jid));
}

/**
 * Check whether a group is muted (ordinary members cannot use bot commands).
 */
export async function isGroupMuted(groupJid) {
  const gs = await getGroupSettings(groupJid);
  return gs.muted === true;
}
