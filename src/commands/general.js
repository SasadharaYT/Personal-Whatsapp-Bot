/**
 * commands/general.js — General-purpose commands.
 *
 * Commands: ping, alive, menu, help, owner, groupinfo,
 *           botinfo, runtime, time, jid, support
 */

import config from '../config.js';
import { formatUptime, reply } from '../utils/message.js';
import { stats, getCommands } from '../handler.js';

/* ── Helpers ──────────────────────────────────────────────────────────── */

function uptime() { return Date.now() - stats.startTime; }

function now(tz) {
  return new Date().toLocaleString('en-US', {
    timeZone:     tz,
    dateStyle:    'medium',
    timeStyle:    'medium',
    hour12:       true,
  });
}

/* ── Command definitions ──────────────────────────────────────────────── */

const commands = [

  /* ── ping ── */
  {
    name:        'ping',
    aliases:     ['p'],
    description: 'Check if the bot is online and measure response time.',
    category:    'General',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    3,
    async execute({ sock, ctx, prefix }) {
      const start = Date.now();
      await reply(sock, ctx, '🏓 Pong!');
      const elapsed = Date.now() - start;
      await reply(sock, ctx, `⚡ Response time: *${elapsed}ms*`);
    },
  },

  /* ── alive ── */
  {
    name:        'alive',
    aliases:     ['online'],
    description: 'Show the bot online status, name, and uptime.',
    category:    'General',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, prefix }) {
      const text = [
        `✅ *${config.botName}* is alive and running!`,
        `⏱ Uptime: ${formatUptime(uptime())}`,
        `🌐 Connected: ${sock.user?.id ? 'Yes' : 'No'}`,
        `📦 Version: v${config.botVersion}`,
        `🕐 Time: ${now(config.timezone)}`,
      ].join('\n');
      await reply(sock, ctx, text);
    },
  },

  /* ── menu ── */
  {
    name:        'menu',
    aliases:     ['commands', 'help'],
    description: 'Display all commands grouped by category.',
    category:    'General',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, prefix, isOwner, isAdmin }) {
      const all    = getCommands();
      const groups = {};

      for (const [, cmd] of all) {
        // Filter owner-only for non-owners, admin-only summary still shown
        if (cmd.ownerOnly && !isOwner) continue;
        const cat = cmd.category ?? 'General';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(cmd);
      }

      const lines = [
        `╔══════════════════════╗`,
        `║  *${config.botName} Commands*  ║`,
        `╚══════════════════════╝`,
        `Prefix: *${prefix}*   Uptime: *${formatUptime(uptime())}*`,
        '',
      ];

      for (const [cat, cmds] of Object.entries(groups).sort()) {
        lines.push(`*─── ${cat} ───*`);
        for (const cmd of cmds) {
          const lock = cmd.adminOnly ? '🔒' : cmd.ownerOnly ? '👑' : '';
          lines.push(`  ${prefix}${cmd.name} ${lock}  — ${cmd.description}`);
        }
        lines.push('');
      }

      lines.push(`_Use ${prefix}help <command> for detailed info._`);
      await reply(sock, ctx, lines.join('\n'));
    },
  },

  /* ── help ── */
  {
    name:        'help',
    aliases:     [],
    description: 'Show detailed help for a specific command.',
    category:    'General',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    3,
    async execute({ sock, ctx, args, prefix }) {
      if (!args[0]) {
        await reply(sock, ctx, `Usage: ${prefix}help <command>\nExample: ${prefix}help ping`);
        return;
      }
      const { getCommand } = await import('../handler.js');
      const cmd = getCommand(args[0].toLowerCase().replace(/^\./, ''));
      if (!cmd) {
        await reply(sock, ctx, `❌ Command *${args[0]}* not found.`);
        return;
      }
      const lines = [
        `*${prefix}${cmd.name}*`,
        `📝 ${cmd.description}`,
        `🏷 Category: ${cmd.category ?? 'General'}`,
      ];
      if (cmd.aliases?.length) lines.push(`🔀 Aliases: ${cmd.aliases.map(a => prefix + a).join(', ')}`);
      if (cmd.adminOnly)  lines.push(`🔒 Requires: *Group Admin*`);
      if (cmd.ownerOnly)  lines.push(`👑 Requires: *Bot Owner*`);
      if (cmd.groupOnly)  lines.push(`👥 Groups only`);
      if (cmd.cooldown)   lines.push(`⏳ Cooldown: ${cmd.cooldown}s`);
      await reply(sock, ctx, lines.join('\n'));
    },
  },

  /* ── owner ── */
  {
    name:        'owner',
    aliases:     [],
    description: 'Show the bot owner contact information.',
    category:    'General',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    10,
    async execute({ sock, ctx }) {
      const ownerNums = config.ownerNumbers.map(j => j.split('@')[0]);
      const lines = [
        `👑 *Bot Owner*`,
        ...ownerNums.map(n => `📱 wa.me/${n}`),
        config.supportLink ? `🔗 Support: ${config.supportLink}` : '',
      ].filter(Boolean);
      await reply(sock, ctx, lines.join('\n'));
    },
  },

  /* ── groupinfo ── */
  {
    name:        'groupinfo',
    aliases:     ['ginfo'],
    description: 'Show group name, description, and participant count.',
    category:    'General',
    groupOnly:   true,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    10,
    async execute({ sock, ctx }) {
      try {
        const meta = await sock.groupMetadata(ctx.jid);
        const admins = meta.participants.filter(p => p.admin).length;
        const text = [
          `📋 *Group Info*`,
          `📌 Name: ${meta.subject}`,
          `👥 Members: ${meta.participants.length} (${admins} admin${admins !== 1 ? 's' : ''})`,
          `🆔 JID: ${meta.id}`,
          meta.desc ? `📝 Description: ${meta.desc}` : '',
          meta.creation ? `📅 Created: ${new Date(meta.creation * 1000).toLocaleDateString()}` : '',
        ].filter(Boolean).join('\n');
        await reply(sock, ctx, text);
      } catch {
        await reply(sock, ctx, '❌ Could not fetch group info.');
      }
    },
  },

  /* ── botinfo ── */
  {
    name:        'botinfo',
    aliases:     ['info'],
    description: 'Show bot version, runtime, and prefix.',
    category:    'General',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, prefix }) {
      const { getGlobalSettings } = await import('../services/settings.js');
      const gs = await getGlobalSettings();
      const text = [
        `🤖 *${gs.botName ?? config.botName}*`,
        `📦 Version: v${config.botVersion}`,
        `⚡ Runtime: Node.js ${process.version}`,
        `🔑 Prefix: *${gs.prefix ?? prefix}*`,
        `⏱ Uptime: ${formatUptime(uptime())}`,
        `🌏 Timezone: ${config.timezone}`,
      ].join('\n');
      await reply(sock, ctx, text);
    },
  },

  /* ── runtime ── */
  {
    name:        'runtime',
    aliases:     ['uptime'],
    description: 'Display how long the bot has been running.',
    category:    'General',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx }) {
      await reply(sock, ctx, `⏱ Bot uptime: *${formatUptime(uptime())}*`);
    },
  },

  /* ── time ── */
  {
    name:        'time',
    aliases:     ['date'],
    description: 'Show the current date and time in the configured timezone.',
    category:    'General',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx }) {
      await reply(sock, ctx, `🕐 *${config.timezone}*\n${now(config.timezone)}`);
    },
  },

  /* ── jid ── */
  {
    name:        'jid',
    aliases:     ['id'],
    description: "Show your own JID and the current group's JID.",
    category:    'General',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx }) {
      const lines = [`🆔 *Your JID:* ${ctx.sender}`];
      if (ctx.isGroup) lines.push(`👥 *Group JID:* ${ctx.jid}`);
      await reply(sock, ctx, lines.join('\n'));
    },
  },

  /* ── support ── */
  {
    name:        'support',
    aliases:     [],
    description: 'Show support information.',
    category:    'General',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    10,
    async execute({ sock, ctx }) {
      const lines = [
        `🆘 *Support*`,
        config.supportLink ? `🔗 ${config.supportLink}` : 'Contact the bot owner for support.',
        `👑 Owner: ${config.ownerNumbers.map(j => 'wa.me/' + j.split('@')[0]).join(', ')}`,
      ];
      await reply(sock, ctx, lines.join('\n'));
    },
  },

];

export default commands;
