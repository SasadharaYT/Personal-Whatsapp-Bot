/**
 * commands/group.js — Group information and tag commands.
 *
 * Commands: tagall, hidetag, admins, tagadmin, antilink, welcome,
 *           setwelcome, goodbye, setgoodbye, mute, unmute
 */

import { reply, mentionJid } from '../utils/message.js';
import { getGroupSettings, saveGroupSettings, patchGroupSettings } from '../services/settings.js';
import { getGroupPermissions, normaliseJid } from '../services/permissions.js';
import config from '../config.js';

/* ── Helpers ──────────────────────────────────────────────────────────── */

const BATCH_SIZE = 5; // tag at most 5 per message to avoid spam blocks

async function requireGroup(sock, ctx) {
  if (!ctx.isGroup) {
    await reply(sock, ctx, '❌ This command can only be used in a group.');
    return false;
  }
  return true;
}

/* ── Commands ─────────────────────────────────────────────────────────── */

const commands = [

  /* ── tagall ── */
  {
    name:        'tagall',
    aliases:     ['everyone', 'all'],
    description: 'Mention all group members with an optional message.',
    category:    'Group',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    30,
    async execute({ sock, ctx, args, prefix }) {
      if (!await requireGroup(sock, ctx)) return;

      const { metadata } = await getGroupPermissions(sock, ctx.jid, ctx.sender);
      if (!metadata) { await reply(sock, ctx, '❌ Could not fetch group info.'); return; }

      const msg = args.join(' ') || '👋';
      const participants = metadata.participants.map(p => normaliseJid(p.id));

      // Send in batches
      for (let i = 0; i < participants.length; i += BATCH_SIZE) {
        const batch = participants.slice(i, i + BATCH_SIZE);
        const mentionText = batch.map(mentionJid).join(' ');
        await sock.sendMessage(ctx.jid, {
          text:    `${i === 0 ? msg + '\n\n' : ''}${mentionText}`,
          mentions: batch,
        });
        if (i + BATCH_SIZE < participants.length) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    },
  },

  /* ── hidetag ── */
  {
    name:        'hidetag',
    aliases:     ['h'],
    description: 'Silently mention all members without listing their names.',
    category:    'Group',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    30,
    async execute({ sock, ctx, args }) {
      if (!await requireGroup(sock, ctx)) return;

      const { metadata } = await getGroupPermissions(sock, ctx.jid, ctx.sender);
      if (!metadata) { await reply(sock, ctx, '❌ Could not fetch group info.'); return; }

      const msg = args.join(' ') || '👋';
      const participants = metadata.participants.map(p => normaliseJid(p.id));

      await sock.sendMessage(ctx.jid, {
        text:     msg,
        mentions: participants,
      });
    },
  },

  /* ── admins ── */
  {
    name:        'admins',
    aliases:     [],
    description: 'List all group administrators.',
    category:    'Group',
    groupOnly:   true,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    10,
    async execute({ sock, ctx }) {
      if (!await requireGroup(sock, ctx)) return;

      const { metadata } = await getGroupPermissions(sock, ctx.jid, ctx.sender);
      if (!metadata) { await reply(sock, ctx, '❌ Could not fetch group info.'); return; }

      const adminList = metadata.participants.filter(p => p.admin);
      if (!adminList.length) {
        await reply(sock, ctx, '❌ No admins found.');
        return;
      }

      const lines = ['👮 *Group Admins*', ''];
      for (const a of adminList) {
        const jid  = normaliseJid(a.id);
        const role = a.admin === 'superadmin' ? '⭐ Super Admin' : '🔑 Admin';
        lines.push(`${role}: ${mentionJid(jid)}`);
      }

      await sock.sendMessage(ctx.jid, {
        text:     lines.join('\n'),
        mentions: adminList.map(a => normaliseJid(a.id)),
      });
    },
  },

  /* ── tagadmin ── */
  {
    name:        'tagadmin',
    aliases:     ['admintag'],
    description: 'Mention all group administrators.',
    category:    'Group',
    groupOnly:   true,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    15,
    async execute({ sock, ctx, args }) {
      if (!await requireGroup(sock, ctx)) return;

      const { metadata } = await getGroupPermissions(sock, ctx.jid, ctx.sender);
      if (!metadata) { await reply(sock, ctx, '❌ Could not fetch group info.'); return; }

      const adminList  = metadata.participants.filter(p => p.admin);
      const adminJids  = adminList.map(p => normaliseJid(p.id));
      const msg        = args.join(' ') || '📢';

      await sock.sendMessage(ctx.jid, {
        text:     `${msg}\n\n${adminJids.map(mentionJid).join(' ')}`,
        mentions: adminJids,
      });
    },
  },

  /* ── antilink ── */
  {
    name:        'antilink',
    aliases:     [],
    description: 'Toggle anti-link protection. Usage: .antilink on|off|status',
    category:    'Group',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      if (!await requireGroup(sock, ctx)) return;

      const sub = (args[0] ?? '').toLowerCase();
      if (!['on', 'off', 'status'].includes(sub)) {
        await reply(sock, ctx, '❌ Usage: .antilink on | off | status');
        return;
      }

      const gs = await getGroupSettings(ctx.jid);

      if (sub === 'status') {
        await reply(sock, ctx, [
          `🔗 *Anti-Link Status*`,
          `Status: ${gs.antilink.enabled ? '✅ ON' : '❌ OFF'}`,
          `Warn limit: ${gs.antilink.warnLimit}`,
          `Allowlist: ${gs.antilink.allowlist.length ? gs.antilink.allowlist.join(', ') : 'None'}`,
        ].join('\n'));
        return;
      }

      gs.antilink.enabled = sub === 'on';
      await saveGroupSettings(ctx.jid, gs);
      await reply(sock, ctx, `🔗 Anti-Link is now *${sub === 'on' ? 'ON ✅' : 'OFF ❌'}*`);
    },
  },

  /* ── welcome ── */
  {
    name:        'welcome',
    aliases:     [],
    description: 'Toggle welcome messages. Usage: .welcome on|off',
    category:    'Group',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      if (!await requireGroup(sock, ctx)) return;

      const sub = (args[0] ?? '').toLowerCase();
      if (!['on', 'off'].includes(sub)) {
        await reply(sock, ctx, '❌ Usage: .welcome on | off');
        return;
      }

      await patchGroupSettings(ctx.jid, { welcome: { enabled: sub === 'on' } });
      await reply(sock, ctx, `👋 Welcome messages are now *${sub === 'on' ? 'ON ✅' : 'OFF ❌'}*`);
    },
  },

  /* ── setwelcome ── */
  {
    name:        'setwelcome',
    aliases:     [],
    description: 'Set a custom welcome message. Placeholders: {user}, {group}, {count}',
    category:    'Group',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      if (!await requireGroup(sock, ctx)) return;

      const message = args.join(' ');
      if (!message) {
        await reply(sock, ctx, '❌ Usage: .setwelcome <message>\nPlaceholders: {user} {group} {count}');
        return;
      }

      await patchGroupSettings(ctx.jid, { welcome: { message } });
      await reply(sock, ctx, `✅ Welcome message updated:\n\n${message}`);
    },
  },

  /* ── goodbye ── */
  {
    name:        'goodbye',
    aliases:     [],
    description: 'Toggle goodbye messages. Usage: .goodbye on|off',
    category:    'Group',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      if (!await requireGroup(sock, ctx)) return;

      const sub = (args[0] ?? '').toLowerCase();
      if (!['on', 'off'].includes(sub)) {
        await reply(sock, ctx, '❌ Usage: .goodbye on | off');
        return;
      }

      await patchGroupSettings(ctx.jid, { goodbye: { enabled: sub === 'on' } });
      await reply(sock, ctx, `👋 Goodbye messages are now *${sub === 'on' ? 'ON ✅' : 'OFF ❌'}*`);
    },
  },

  /* ── setgoodbye ── */
  {
    name:        'setgoodbye',
    aliases:     [],
    description: 'Set a custom goodbye message. Placeholders: {user}, {group}',
    category:    'Group',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      if (!await requireGroup(sock, ctx)) return;

      const message = args.join(' ');
      if (!message) {
        await reply(sock, ctx, '❌ Usage: .setgoodbye <message>\nPlaceholders: {user} {group}');
        return;
      }

      await patchGroupSettings(ctx.jid, { goodbye: { message } });
      await reply(sock, ctx, `✅ Goodbye message updated:\n\n${message}`);
    },
  },

  /* ── mute ── */
  {
    name:        'mute',
    aliases:     [],
    description: 'Disable bot commands for regular members in this group.',
    category:    'Group',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx }) {
      await patchGroupSettings(ctx.jid, { muted: true });
      await reply(sock, ctx, '🔇 Bot is now *muted* for regular members.');
    },
  },

  /* ── unmute ── */
  {
    name:        'unmute',
    aliases:     [],
    description: 'Enable bot commands for all members in this group.',
    category:    'Group',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx }) {
      await patchGroupSettings(ctx.jid, { muted: false });
      await reply(sock, ctx, '🔊 Bot is now *unmuted* for all members.');
    },
  },

];

export default commands;
