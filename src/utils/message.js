/**
 * utils/message.js — Message normalisation helpers.
 *
 * Extracts text, quoted messages, mentions, and other metadata
 * from any Baileys message object in a safe, version-aware way.
 */

import { normaliseJid } from '../services/permissions.js';
import config from '../config.js';

/**
 * Extract the plain text body from a Baileys message.
 * Handles: conversation, extendedTextMessage, imageMessage, videoMessage,
 * ephemeral, viewOnce, edited messages, etc.
 */
export function extractText(message) {
  if (!message) return '';

  let m = message;
  while (
    m?.ephemeralMessage?.message ||
    m?.viewOnceMessage?.message ||
    m?.viewOnceMessageV2?.message ||
    m?.documentWithCaptionMessage?.message ||
    m?.editedMessage?.message?.protocolMessage?.editedMessage
  ) {
    m =
      m?.ephemeralMessage?.message ??
      m?.viewOnceMessage?.message ??
      m?.viewOnceMessageV2?.message ??
      m?.documentWithCaptionMessage?.message ??
      m?.editedMessage?.message?.protocolMessage?.editedMessage;
  }

  return (
    m?.conversation                                           ??
    m?.extendedTextMessage?.text                              ??
    m?.imageMessage?.caption                                  ??
    m?.videoMessage?.caption                                  ??
    m?.documentMessage?.caption                               ??
    m?.buttonsResponseMessage?.selectedDisplayText            ??
    m?.listResponseMessage?.title                             ??
    m?.templateButtonReplyMessage?.selectedDisplayText        ??
    m?.interactiveResponseMessage?.body?.text                 ??
    ''
  );
}

/**
 * Get the quoted (context) message from an extendedTextMessage.
 * Returns null if no quoted message is present.
 */
export function getQuotedMessage(msg) {
  const ctx = msg?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;
  return {
    key: {
      remoteJid:   ctx.remoteJid  ?? msg.key?.remoteJid,
      fromMe:      ctx.participant === msg.key?.participant,
      id:          ctx.stanzaId,
      participant: ctx.participant,
    },
    message: ctx.quotedMessage,
    sender:  ctx.participant,
    text:    extractText(ctx.quotedMessage),
  };
}

/**
 * Parse a raw Baileys message into a normalised context object
 * ready for command handling.
 *
 * @param {object} raw - The raw message object from messages.upsert
 * @param {object} sock - The Baileys socket instance
 */
export function parseMessage(raw, sock) {
  if (!raw?.key) return null;

  const { key, message, pushName, messageTimestamp } = raw;
  if (!message) return null;

  const jid        = key.remoteJid ?? '';
  const isGroup    = jid.endsWith('@g.us');
  const fromMe     = key.fromMe === true;

  // When fromMe is true, the message was sent from this WhatsApp account (the bot owner).
  // In 1-on-1 chats, key.remoteJid is the recipient, so we must attribute the sender to the bot/owner JID.
  const botJid     = sock?.user?.id ? normaliseJid(sock.user.id) : (config.ownerNumbers[0] ?? '');
  const senderJid  = fromMe
    ? botJid
    : (isGroup ? (key.participant ?? raw.participant ?? '') : jid);

  const sender     = normaliseJid(senderJid);
  const chat       = jid;
  const isStatus   = jid === 'status@broadcast';
  const text       = extractText(message).trim();
  const quoted     = getQuotedMessage(message);

  // Mentioned JIDs from extended text
  const unwrapped  = message?.ephemeralMessage?.message ?? message;
  const mentions   = unwrapped?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];

  return {
    key,
    message,
    raw,
    sock,
    jid,
    chat,
    sender,
    senderJid,
    fromMe,
    isGroup,
    isStatus,
    text,
    quoted,
    mentions,
    pushName:  pushName ?? '',
    timestamp: typeof messageTimestamp === 'bigint'
      ? Number(messageTimestamp)
      : (messageTimestamp ?? 0),
  };
}

/* ── Bot-sent message tracking ─────────────────────────────────────────── */

export const botSentIds = new Set();

export function recordBotSent(id) {
  if (!id) return;
  botSentIds.add(id);
  if (botSentIds.size > 2000) {
    const first = botSentIds.values().next().value;
    botSentIds.delete(first);
  }
}

/**
 * Reply to a message with text.
 */
export async function reply(sock, ctx, text) {
  let sent;
  try {
    sent = await sock.sendMessage(ctx.chat, { text }, { quoted: ctx.raw });
  } catch {
    sent = await sock.sendMessage(ctx.chat, { text });
  }
  if (sent?.key?.id) recordBotSent(sent.key.id);
  return sent;
}

/**
 * Send a plain text message to a chat without quoting.
 */
export async function send(sock, jid, text) {
  const sent = await sock.sendMessage(jid, { text });
  if (sent?.key?.id) recordBotSent(sent.key.id);
  return sent;
}

/**
 * Send an image message.
 */
export async function sendImage(sock, ctx, buffer, caption = '') {
  let sent;
  try {
    sent = await sock.sendMessage(ctx.chat, { image: buffer, caption }, { quoted: ctx.raw });
  } catch {
    sent = await sock.sendMessage(ctx.chat, { image: buffer, caption });
  }
  if (sent?.key?.id) recordBotSent(sent.key.id);
  return sent;
}

/**
 * Send a video message.
 */
export async function sendVideo(sock, ctx, buffer, caption = '') {
  let sent;
  try {
    sent = await sock.sendMessage(ctx.chat, { video: buffer, caption, mimetype: 'video/mp4' }, { quoted: ctx.raw });
  } catch {
    sent = await sock.sendMessage(ctx.chat, { video: buffer, caption, mimetype: 'video/mp4' });
  }
  if (sent?.key?.id) recordBotSent(sent.key.id);
  return sent;
}

/**
 * Send an audio message.
 */
export async function sendAudio(sock, ctx, buffer) {
  let sent;
  try {
    sent = await sock.sendMessage(ctx.chat, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: ctx.raw });
  } catch {
    sent = await sock.sendMessage(ctx.chat, { audio: buffer, mimetype: 'audio/mpeg', ptt: false });
  }
  if (sent?.key?.id) recordBotSent(sent.key.id);
  return sent;
}

/**
 * Format uptime in human-readable form.
 */
export function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) {
    parts.push(`${d}d`, `${h}h`, `${m}m`);
  } else if (h) {
    parts.push(`${h}h`, `${m}m`);
  } else if (m) {
    parts.push(`${m}m`);
  }
  parts.push(`${sec}s`);
  return parts.join(' ');
}

/**
 * Format a phone number JID into a readable mention string.
 */
export function mentionJid(jid) {
  const num = normaliseJid(jid).split('@')[0];
  return `@${num}`;
}

/**
 * Validate a phone number string (digits only, 7–15 chars).
 */
export function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Convert a phone number to a WhatsApp JID.
 */
export function phoneToJid(phone) {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}
