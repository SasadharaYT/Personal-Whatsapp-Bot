/**
 * commands/owner.js — Bot owner-only commands.
 *
 * Commands: restart, shutdown, setprefix, setname, broadcast,
 *           grouplist, stats, reload, block, unblock
 *
 * All commands are restricted to phone numbers in OWNER_NUMBERS.
 */

import { reply, send, formatUptime, isValidPhone, phoneToJid } from '../utils/message.js';
import { patchGlobalSettings } from '../services/settings.js';
import { blockUser, unblockUser } from '../services/settings.js';
import { stats, loadCommands } from '../handler.js';
import { normaliseJid } from '../services/permissions.js';
import config from '../config.js';
import logger from '../services/logger.js';

/* ── Pending broadcast confirmations ──────────────────────────────────── */
/** senderJid → { message, groups, expires } */
const pendingBroadcasts = new Map();

/* ── Commands ─────────────────────────────────────────────────────────── */

const commands = [

  /* ── restart ── */
  {
    name:        'restart',
    aliases:     [],
    description: 'Request a controlled bot restart.',
    category:    'Owner',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   true,
    cooldown:    10,
    async execute({ sock, ctx }) {
      await reply(sock, ctx, '🔄 Restarting bot... please wait.');
      logger.info('Restart requested by owner');
      // Defer to allow the reply to be sent
      setTimeout(() => process.exit(0), 1500);
    },
  },

  /* ── shutdown ── */
  {
    name:        'shutdown',
    aliases:     ['stop'],
    description: 'Gracefully shut down the bot.',
    category:    'Owner',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   true,
    cooldown:    10,
    async execute({ sock, ctx }) {
      await reply(sock, ctx, '👋 Shutting down gracefully...');
      logger.info('Shutdown requested by owner');
      setTimeout(() => process.exit(0), 1500);
    },
  },

  /* ── setprefix ── */
  {
    name:        'setprefix',
    aliases:     [],
    description: 'Change and persist the command prefix. Usage: .setprefix <prefix>',
    category:    'Owner',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   true,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      const newPrefix = args[0];
      if (!newPrefix || newPrefix.length > 3) {
        await reply(sock, ctx, '❌ Provide a valid prefix (1–3 characters).');
        return;
      }
      await patchGlobalSettings({ prefix: newPrefix });
      await reply(sock, ctx, `✅ Prefix updated to: *${newPrefix}*`);
    },
  },

  /* ── setname ── */
  {
    name:        'setbotname',
    aliases:     ['setname'],
    description: "Change the bot's display name. Usage: .setbotname <name>",
    category:    'Owner',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   true,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      const name = args.join(' ').trim();
      if (!name || name.length > 50) {
        await reply(sock, ctx, '❌ Provide a valid bot name (1–50 characters).');
        return;
      }
      await patchGlobalSettings({ botName: name });
      await reply(sock, ctx, `✅ Bot name updated to: *${name}*`);
    },
  },

  /* ── grouplist ── */
  {
    name:        'grouplist',
    aliases:     ['groups'],
    description: 'List all groups the bot is a member of.',
    category:    'Owner',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   true,
    cooldown:    15,
    async execute({ sock, ctx }) {
      try {
        const groups = await sock.groupFetchAllParticipating();
        const list   = Object.values(groups);
        if (!list.length) {
          await reply(sock, ctx, '📋 The bot is not in any groups.');
          return;
        }
        const lines = ['📋 *Group List*', ''];
        for (const [i, g] of list.entries()) {
          lines.push(`${i + 1}. *${g.subject}* (${g.participants.length} members)\n   🆔 ${g.id}`);
        }
        await reply(sock, ctx, lines.join('\n'));
      } catch (err) {
        await reply(sock, ctx, `❌ Failed to fetch groups: ${err.message}`);
      }
    },
  },

  /* ── stats ── */
  {
    name:        'stats',
    aliases:     [],
    description: 'Show bot statistics: uptime, messages, commands, errors.',
    category:    'Owner',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   true,
    cooldown:    5,
    async execute({ sock, ctx }) {
      const up = formatUptime(Date.now() - stats.startTime);
      const text = [
        `📊 *Bot Statistics*`,
        `⏱ Uptime: ${up}`,
        `📨 Messages processed: ${stats.messagesProcessed}`,
        `⚡ Commands executed: ${stats.commandsExecuted}`,
        `❌ Errors: ${stats.errors}`,
        `💾 Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
      ].join('\n');
      await reply(sock, ctx, text);
    },
  },

  /* ── broadcast ── */
  {
    name:        'broadcast',
    aliases:     ['bc'],
    description: 'Send a message to all groups. Requires confirmation for multi-group.',
    category:    'Owner',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   true,
    cooldown:    30,
    async execute({ sock, ctx, args }) {
      // Check for pending confirmation
      const pending = pendingBroadcasts.get(ctx.sender);
      if (pending && Date.now() < pending.expires && args[0]?.toLowerCase() === 'confirm') {
        pendingBroadcasts.delete(ctx.sender);
        let sent = 0;
        for (const g of pending.groups) {
          try {
            await send(sock, g.id, `📢 *Broadcast*\n\n${pending.message}`);
            sent++;
            await new Promise(r => setTimeout(r, 1000)); // rate limit
          } catch { /* skip failed */ }
        }
        await reply(sock, ctx, `✅ Broadcast sent to *${sent}* groups.`);
        return;
      }

      if (args[0]?.toLowerCase() === 'cancel') {
        pendingBroadcasts.delete(ctx.sender);
        await reply(sock, ctx, '❌ Broadcast cancelled.');
        return;
      }

      const message = args.join(' ').trim();
      if (!message) {
        await reply(sock, ctx, '❌ Usage: .broadcast <message>\nOr: .broadcast confirm | .broadcast cancel');
        return;
      }

      try {
        const groups = Object.values(await sock.groupFetchAllParticipating());
        if (!groups.length) {
          await reply(sock, ctx, '❌ Bot is not in any groups.');
          return;
        }

        if (groups.length === 1) {
          await send(sock, groups[0].id, `📢 *Broadcast*\n\n${message}`);
          await reply(sock, ctx, '✅ Broadcast sent.');
          return;
        }

        // Store pending and ask for confirmation
        pendingBroadcasts.set(ctx.sender, {
          message,
          groups,
          expires: Date.now() + 60_000, // 60 seconds to confirm
        });
        await reply(sock, ctx, [
          `⚠️ *Broadcast Confirmation*`,
          `This will send to *${groups.length}* groups.`,
          `\nType *.broadcast confirm* to proceed or *.broadcast cancel* to abort.`,
          `(Expires in 60 seconds)`,
        ].join('\n'));
      } catch (err) {
        await reply(sock, ctx, `❌ Failed: ${err.message}`);
      }
    },
  },

  /* ── reload ── */
  {
    name:        'reload',
    aliases:     [],
    description: 'Reload command modules and configuration.',
    category:    'Owner',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   true,
    cooldown:    10,
    async execute({ sock, ctx }) {
      try {
        // ES modules are cached — we can clear the registry and re-import
        const { getCommands } = await import('../handler.js');
        getCommands().clear();
        await loadCommands();
        await reply(sock, ctx, '✅ Commands reloaded successfully.');
      } catch (err) {
        logger.error({ err }, 'Reload failed');
        await reply(sock, ctx, `❌ Reload failed: ${err.message}`);
      }
    },
  },

  /* ── block ── */
  {
    name:        'block',
    aliases:     [],
    description: 'Block a sender from using the bot. Usage: .block <number>',
    category:    'Owner',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   true,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      const num = (args[0] ?? '').replace(/\D/g, '');
      if (!isValidPhone(num)) {
        await reply(sock, ctx, '❌ Provide a valid phone number. E.g: .block 94771234567');
        return;
      }
      const jid = phoneToJid(num);
      await blockUser(normaliseJid(jid));
      await reply(sock, ctx, `✅ *${num}* has been blocked from using the bot.`);
    },
  },

  /* ── unblock ── */
  {
    name:        'unblock',
    aliases:     [],
    description: 'Unblock a sender. Usage: .unblock <number>',
    category:    'Owner',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   true,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      const num = (args[0] ?? '').replace(/\D/g, '');
      if (!isValidPhone(num)) {
        await reply(sock, ctx, '❌ Provide a valid phone number. E.g: .unblock 94771234567');
        return;
      }
      const jid = phoneToJid(num);
      await unblockUser(normaliseJid(jid));
      await reply(sock, ctx, `✅ *${num}* has been unblocked.`);
    },
  },

];

export default commands;
