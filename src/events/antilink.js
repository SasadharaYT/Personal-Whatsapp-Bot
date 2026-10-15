/**
 * events/antilink.js — Anti-link enforcement logic.
 *
 * Detects WhatsApp group invite links and configurable external URLs.
 * Exempts admins, owners, and allowlisted domains.
 * Deletes messages and issues warnings; optionally kicks repeat offenders.
 */

import { parseMessage, extractText } from '../utils/message.js';
import { isOwner, normaliseJid, isBotGroupAdmin } from '../services/permissions.js';
import {
  getGroupSettings,
  saveGroupSettings,
  addAntilinkWarning,
} from '../services/settings.js';
import { getGroupPermissions } from '../services/permissions.js';
import config from '../config.js';
import logger from '../services/logger.js';

// Dedup set for antilink — prevent double-processing
const processed = new Set();

/* ── Link detection regexes ─────────────────────────────────────────────── */

const WA_INVITE_RE = /chat\.whatsapp\.com\/[A-Za-z0-9+/]{10,}/g;

function buildExternalRe(domains) {
  if (!domains.length) return null;
  const escaped = domains.map(d => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?:https?://)?(?:www\\.)?(?:${escaped.join('|')})`, 'gi');
}

/**
 * Check a text body for disallowed links.
 * Returns true if a violating link was found.
 */
function containsLink(text, allowlist, blockedDomains) {
  if (!text) return false;

  // WhatsApp invite links
  if (WA_INVITE_RE.test(text)) {
    WA_INVITE_RE.lastIndex = 0; // reset stateful regex
    return true;
  }
  WA_INVITE_RE.lastIndex = 0;

  // External blocked domains
  const extRe = buildExternalRe(blockedDomains);
  if (extRe && extRe.test(text)) return true;

  return false;
}

/**
 * Check whether a domain is in the group allowlist.
 */
function isAllowed(text, allowlist) {
  if (!allowlist?.length) return false;
  return allowlist.some(domain =>
    text.toLowerCase().includes(domain.toLowerCase())
  );
}

/* ── Main check ─────────────────────────────────────────────────────────── */

/**
 * Run anti-link checks on an incoming message.
 * Called before command dispatch.
 */
export async function checkAntiLink(sock, rawMsg) {
  try {
    const ctx = parseMessage(rawMsg, sock);
    if (!ctx || !ctx.isGroup || ctx.fromMe || ctx.isStatus) return;

    // Dedup
    if (processed.has(ctx.key.id)) return;
    processed.add(ctx.key.id);
    setTimeout(() => processed.delete(ctx.key.id), 60_000);

    const gs = await getGroupSettings(ctx.jid);
    if (!gs.antilink.enabled) return;

    const text = ctx.text;
    if (!text) return;

    // Check allowlist first
    if (isAllowed(text, gs.antilink.allowlist)) return;

    // Owners and admins are exempt
    if (isOwner(ctx.sender)) return;

    const { isAdmin } = await getGroupPermissions(sock, ctx.jid, ctx.sender);
    if (isAdmin) return;

    const blocked = [...(config.blockedDomains ?? [])];
    if (!containsLink(text, gs.antilink.allowlist, blocked)) return;

    // ── Violation detected ────────────────────────────────────────────
    logger.info({ sender: ctx.sender, chat: ctx.jid }, 'Anti-link violation detected');

    // Delete the message if bot is admin
    const botAdmin = await isBotGroupAdmin(sock, ctx.jid);
    if (botAdmin) {
      try {
        await sock.sendMessage(ctx.jid, {
          delete: {
            remoteJid:   ctx.jid,
            fromMe:      false,
            id:          ctx.key.id,
            participant: ctx.senderJid,
          },
        });
      } catch (err) {
        logger.warn({ err }, 'Failed to delete antilink message');
      }
    }

    // Issue warning
    const warnCount = await addAntilinkWarning(ctx.jid, ctx.sender);
    const limit     = gs.antilink.warnLimit ?? config.antilinkWarnLimit;

    await sock.sendMessage(ctx.jid, {
      text:     `⚠️ @${ctx.sender.split('@')[0]} — Links are not allowed in this group.\nWarning ${warnCount}/${limit}.`,
      mentions: [ctx.sender],
    });

    // Kick on threshold breach
    if (warnCount >= limit && botAdmin) {
      try {
        await sock.groupParticipantsUpdate(ctx.jid, [ctx.sender], 'remove');
        await sock.sendMessage(ctx.jid, {
          text:     `❌ @${ctx.sender.split('@')[0]} was removed after ${warnCount} anti-link violations.`,
          mentions: [ctx.sender],
        });
        // Reset warnings after kick
        gs.antilink.warnings[ctx.sender] = 0;
        await saveGroupSettings(ctx.jid, gs);
      } catch (err) {
        logger.warn({ err }, 'Failed to kick antilink violator');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Anti-link check error');
  }
}
