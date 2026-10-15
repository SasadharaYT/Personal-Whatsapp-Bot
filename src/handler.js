/**
 * handler.js — Command registry and message dispatch system.
 *
 * Responsibilities:
 *  - Load and register all command modules
 *  - Parse prefix, command name, args, and aliases
 *  - Enforce cooldowns, rate limits, and permission checks
 *  - Dispatch to the correct command executor
 *  - Handle errors without exposing internals to users
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { parseMessage, reply, botSentIds } from './utils/message.js';
import { isOwner, isGroupAdmin, isUserBlocked, isGroupMuted } from './services/permissions.js';
import { getGlobalSettings } from './services/settings.js';
import logger from './services/logger.js';
import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── Command Registry ──────────────────────────────────────────────────── */

/** @type {Map<string, CommandDef>} */
const commands = new Map();

/** @type {Map<string, string>} alias → canonical name */
const aliases = new Map();

/** Stats counters */
export const stats = {
  messagesProcessed: 0,
  commandsExecuted:  0,
  errors:            0,
  startTime:         Date.now(),
};

/**
 * Register a command definition.
 * @param {CommandDef} cmd
 */
export function registerCommand(cmd) {
  if (!cmd.name || typeof cmd.execute !== 'function') {
    throw new Error(`[handler] Invalid command definition: ${JSON.stringify(cmd)}`);
  }
  commands.set(cmd.name.toLowerCase(), cmd);
  for (const alias of (cmd.aliases ?? [])) {
    aliases.set(alias.toLowerCase(), cmd.name.toLowerCase());
  }
}

/** Return all registered commands. */
export function getCommands() { return commands; }

/** Return a single command by name or alias. */
export function getCommand(name) {
  const key = name.toLowerCase();
  return commands.get(key) ?? commands.get(aliases.get(key) ?? '');
}

/* ── Cooldown Store ────────────────────────────────────────────────────── */

/** { `${senderJid}:${commandName}` → timestamp } */
const cooldowns = new Map();

function isOnCooldown(senderJid, cmdName) {
  const cmd = getCommand(cmdName);
  const cd  = (cmd?.cooldown ?? 2) * 1000; // default 2 s
  const key = `${senderJid}:${cmdName}`;
  const last = cooldowns.get(key);
  if (!last) return false;
  return Date.now() - last < cd;
}

function setCooldown(senderJid, cmdName) {
  cooldowns.set(`${senderJid}:${cmdName}`, Date.now());
  // Auto-expire after 60 s to prevent unbounded growth
  setTimeout(() => cooldowns.delete(`${senderJid}:${cmdName}`), 60_000);
}

/* ── Seen-message dedup ────────────────────────────────────────────────── */

const seenIds = new Set();
function isDuplicate(msgId) {
  if (seenIds.has(msgId)) return true;
  seenIds.add(msgId);
  if (seenIds.size > 2000) {
    const first = seenIds.values().next().value;
    seenIds.delete(first);
  }
  return false;
}

/* ── Main dispatch ─────────────────────────────────────────────────────── */

/**
 * Handle an incoming message. Called by the messages event handler.
 *
 * @param {object} rawMsg  - Raw Baileys message
 * @param {object} sock    - Baileys socket
 */
export async function handleMessage(rawMsg, sock) {
  try {
    // ── Parse & filter ─────────────────────────────────────────────────
    const ctx = parseMessage(rawMsg, sock);
    if (!ctx)             return; // malformed
    if (ctx.isStatus)     return; // ignore status broadcasts

    // Ignore messages sent by the bot's own automated replies
    if (ctx.key?.id && botSentIds.has(ctx.key.id)) return;

    // Ignore messages from self unless sender is owner
    if (ctx.fromMe && !isOwner(ctx.sender)) return;

    stats.messagesProcessed++;

    // Deduplicate
    if (isDuplicate(ctx.key.id)) return;

    // Blocked users (skip check for owner)
    if (!ctx.fromMe && await isUserBlocked(ctx.sender)) return;

    // Auto-read
    if (config.autoRead && !ctx.fromMe) {
      await sock.readMessages([ctx.key]).catch(() => {});
    }

    if (!ctx.text) return;

    // ── Determine prefix ───────────────────────────────────────────────
    const gs     = await getGlobalSettings();
    const prefix = gs.prefix ?? config.prefix ?? '.';
    const prefixes = [prefix, '.', '!', '/', '#'].filter(Boolean);

    let matchedPrefix = null;
    let body = '';

    for (const p of prefixes) {
      if (ctx.text.startsWith(p)) {
        matchedPrefix = p;
        body = ctx.text.slice(p.length).trim();
        break;
      }
    }

    // In private chats or for owner messages, also match prefix-less commands
    if (matchedPrefix === null && (!ctx.isGroup || ctx.fromMe)) {
      const firstWord = ctx.text.split(/\s+/)[0]?.toLowerCase();
      if (firstWord && (commands.has(firstWord) || aliases.has(firstWord))) {
        matchedPrefix = '';
        body = ctx.text.trim();
      }
    }

    if (matchedPrefix === null) return; // not a command

    // ── Parse command & args ───────────────────────────────────────────
    const parts   = body.split(/\s+/);
    const cmdName = parts[0]?.toLowerCase();
    const args    = parts.slice(1);

    if (!cmdName) return;

    const cmd = getCommand(cmdName);
    if (!cmd) {
      // Only respond with unknown command in private chat when an explicit prefix was typed
      if (!ctx.isGroup && matchedPrefix !== '') {
        await reply(sock, ctx, `❌ Unknown command *${matchedPrefix}${cmdName}*\nUse *${prefix}menu* to see available commands.`);
      }
      return;
    }

    // ── Permission gates ───────────────────────────────────────────────
    const ownerCheck = isOwner(ctx.sender);
    const adminCheck = ctx.isGroup
      ? await isGroupAdmin(sock, ctx.jid, ctx.sender)
      : false;

    // Group-only restriction
    if (cmd.groupOnly && !ctx.isGroup) {
      await reply(sock, ctx, '❌ This command can only be used in a group.');
      return;
    }

    // Owner-only restriction
    if (cmd.ownerOnly && !ownerCheck) {
      await reply(sock, ctx, '🔒 This command is reserved for the bot owner.');
      return;
    }

    // Admin-only restriction
    if (cmd.adminOnly && !adminCheck && !ownerCheck) {
      await reply(sock, ctx, '🔒 This command requires group administrator privileges.');
      return;
    }

    // Group mute — ordinary members blocked
    if (ctx.isGroup && !ownerCheck && !adminCheck) {
      if (await isGroupMuted(ctx.jid)) {
        await reply(sock, ctx, '🔇 The bot is currently muted for regular members in this group.');
        return;
      }
    }

    // Cooldown (owner is exempt)
    if (!ownerCheck && isOnCooldown(ctx.sender, cmd.name)) {
      await reply(sock, ctx, `⏳ Please wait before using *${prefix}${cmd.name}* again.`);
      return;
    }
    if (!ownerCheck) {
      setCooldown(ctx.sender, cmd.name);
    }

    // ── Execute ────────────────────────────────────────────────────────
    stats.commandsExecuted++;
    logger.info({ cmd: cmd.name, sender: ctx.sender, chat: ctx.chat, fromMe: ctx.fromMe }, 'Executing command');

    await cmd.execute({
      sock,
      ctx,
      args,
      isOwner: ownerCheck,
      isAdmin: adminCheck,
      prefix: matchedPrefix || prefix,
    });

  } catch (err) {
    stats.errors++;
    logger.error({ err }, 'Error in handleMessage');
    try {
      await reply(rawMsg._sock ?? sock, { raw: rawMsg, chat: rawMsg?.key?.remoteJid }, `⚠️ Command error: ${err.message}`);
    } catch { /* ignore reply errors */ }
  }
}

/* ── Module loader ─────────────────────────────────────────────────────── */

/**
 * Dynamically import all command modules.
 * Each module must export an array of CommandDef objects as default.
 */
export async function loadCommands() {
  // Use file:// paths resolved from handler.js location for reliable ESM imports
  const cmdDir = path.join(__dirname, 'commands');
  const files  = ['general.js', 'group.js', 'admin.js', 'owner.js'];

  for (const file of files) {
    const modPath = path.join(cmdDir, file);
    try {
      const mod = await import(`file://${modPath}`);
      const defs = mod.default ?? mod.commands ?? [];
      for (const cmd of defs) {
        registerCommand(cmd);
      }
      logger.debug({ file }, 'Loaded command module');
    } catch (err) {
      logger.error({ err, file }, 'Failed to load command module');
      throw err;
    }
  }

  logger.info(`Loaded ${commands.size} commands.`);
}
