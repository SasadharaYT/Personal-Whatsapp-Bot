/**
 * commands/admin.js — Group administration commands.
 *
 * Commands: kick, add, promote, demote, delete/del/purge,
 *           warn, warnings, resetwarn,
 *           groupopen, groupclose, setname, setdesc, invite, revokeinvite
 */

import { reply, mentionJid, phoneToJid, isValidPhone } from '../utils/message.js';
import { getGroupPermissions, isBotGroupAdmin, normaliseJid } from '../services/permissions.js';
import { addWarn, getWarnings, resetWarnings } from '../services/settings.js';

/* ── Shared guard ─────────────────────────────────────────────────────── */

async function requireBotAdmin(sock, ctx) {
  const isAdm = await isBotGroupAdmin(sock, ctx.jid);
  if (!isAdm) {
    await reply(sock, ctx, '❌ I need to be a *group admin* to perform this action.');
    return false;
  }
  return true;
}

function firstMentionedOrArg(ctx, args) {
  // Prefer @mentioned JID, fallback to first arg as phone number
  if (ctx.mentions?.length) return normaliseJid(ctx.mentions[0]);
  const num = (args[0] ?? '').replace('@', '');
  if (isValidPhone(num)) return phoneToJid(num);
  return null;
}

/* ── Commands ─────────────────────────────────────────────────────────── */

const commands = [

  /* ── kick ── */
  {
    name:        'kick',
    aliases:     ['remove'],
    description: 'Remove a member from the group. Usage: .kick @user',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args, isOwner }) {
      if (!await requireBotAdmin(sock, ctx)) return;

      const target = firstMentionedOrArg(ctx, args);
      if (!target) {
        await reply(sock, ctx, '❌ Mention or provide the phone number of the member to kick.');
        return;
      }

      // Prevent kicking admins unless owner
      const { metadata } = await getGroupPermissions(sock, ctx.jid, ctx.sender);
      const targetInfo = metadata?.participants.find(p => normaliseJid(p.id) === normaliseJid(target));
      if (targetInfo?.admin && !isOwner) {
        await reply(sock, ctx, '❌ Cannot kick a group admin.');
        return;
      }

      try {
        await sock.groupParticipantsUpdate(ctx.jid, [normaliseJid(target)], 'remove');
        await reply(sock, ctx, `✅ ${mentionJid(target)} has been removed from the group.`);
      } catch (err) {
        await reply(sock, ctx, `❌ Failed to kick: ${err.message}`);
      }
    },
  },

  /* ── add ── */
  {
    name:        'add',
    aliases:     [],
    description: 'Add a member to the group. Usage: .add <number>',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    10,
    async execute({ sock, ctx, args }) {
      if (!await requireBotAdmin(sock, ctx)) return;

      const num = (args[0] ?? '').replace(/\D/g, '');
      if (!isValidPhone(num)) {
        await reply(sock, ctx, '❌ Provide a valid phone number with country code. E.g: .add 94771234567');
        return;
      }

      const targetJid = `${num}@s.whatsapp.net`;
      try {
        const result = await sock.groupParticipantsUpdate(ctx.jid, [targetJid], 'add');
        const status = result?.[0]?.status;
        if (status === '200') {
          await reply(sock, ctx, `✅ Added *${num}* to the group.`);
        } else {
          await reply(sock, ctx, `⚠️ Could not add *${num}*. They may have privacy settings preventing it. Status: ${status}`);
        }
      } catch (err) {
        await reply(sock, ctx, `❌ Failed to add: ${err.message}`);
      }
    },
  },

  /* ── promote ── */
  {
    name:        'promote',
    aliases:     [],
    description: 'Promote a member to group admin. Usage: .promote @user',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      if (!await requireBotAdmin(sock, ctx)) return;

      const target = firstMentionedOrArg(ctx, args);
      if (!target) {
        await reply(sock, ctx, '❌ Mention or provide the phone number of the member to promote.');
        return;
      }

      try {
        await sock.groupParticipantsUpdate(ctx.jid, [normaliseJid(target)], 'promote');
        await reply(sock, ctx, `✅ ${mentionJid(target)} has been promoted to *admin*.`);
      } catch (err) {
        await reply(sock, ctx, `❌ Failed to promote: ${err.message}`);
      }
    },
  },

  /* ── demote ── */
  {
    name:        'demote',
    aliases:     [],
    description: 'Demote a group admin to member. Usage: .demote @user',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      if (!await requireBotAdmin(sock, ctx)) return;

      const target = firstMentionedOrArg(ctx, args);
      if (!target) {
        await reply(sock, ctx, '❌ Mention or provide the phone number of the member to demote.');
        return;
      }

      try {
        await sock.groupParticipantsUpdate(ctx.jid, [normaliseJid(target)], 'demote');
        await reply(sock, ctx, `✅ ${mentionJid(target)} has been demoted to *member*.`);
      } catch (err) {
        await reply(sock, ctx, `❌ Failed to demote: ${err.message}`);
      }
    },
  },

  /* ── delete / del / purge ── */
  {
    name:        'delete',
    aliases:     ['del', 'purge'],
    description: 'Delete a quoted message. Reply to the target message and run .delete',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    3,
    async execute({ sock, ctx }) {
      if (!await requireBotAdmin(sock, ctx)) return;

      const quoted = ctx.quoted;
      if (!quoted?.key) {
        await reply(sock, ctx, '❌ Reply to the message you want to delete.');
        return;
      }

      try {
        // Build the correct key for group messages (participant required)
        const key = {
          remoteJid:   ctx.jid,
          fromMe:      quoted.key.fromMe ?? false,
          id:          quoted.key.id,
          participant: quoted.key.participant ?? quoted.sender,
        };
        await sock.sendMessage(ctx.jid, { delete: key });
      } catch (err) {
        await reply(sock, ctx, `❌ Failed to delete message: ${err.message}`);
      }
    },
  },

  /* ── warn ── */
  {
    name:        'warn',
    aliases:     [],
    description: 'Warn a member. Usage: .warn @user [reason]',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      const target = firstMentionedOrArg(ctx, args);
      if (!target) {
        await reply(sock, ctx, '❌ Mention or provide the phone number of the member to warn.');
        return;
      }

      const reason = args.slice(ctx.mentions?.length ? 0 : 1).join(' ') || 'No reason given';
      const warn   = await addWarn(ctx.jid, normaliseJid(target), reason);

      await sock.sendMessage(ctx.jid, {
        text:     `⚠️ *Warning* issued to ${mentionJid(target)}\n📝 Reason: ${reason}\n🔢 Total warnings: ${warn.count}`,
        mentions: [normaliseJid(target)],
      });
    },
  },

  /* ── warnings ── */
  {
    name:        'warnings',
    aliases:     ['warns'],
    description: 'View warnings for a member. Usage: .warnings @user',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      const target = firstMentionedOrArg(ctx, args);
      if (!target) {
        await reply(sock, ctx, '❌ Mention or provide the phone number to check warnings.');
        return;
      }

      const warn = await getWarnings(ctx.jid, normaliseJid(target));
      if (!warn.count) {
        await sock.sendMessage(ctx.jid, {
          text:     `✅ ${mentionJid(target)} has no warnings.`,
          mentions: [normaliseJid(target)],
        });
        return;
      }

      const reasons = warn.reasons.map((r, i) => `  ${i + 1}. ${r}`).join('\n');
      await sock.sendMessage(ctx.jid, {
        text:     `⚠️ *Warnings for ${mentionJid(target)}*\nCount: ${warn.count}\n\n${reasons}`,
        mentions: [normaliseJid(target)],
      });
    },
  },

  /* ── resetwarn ── */
  {
    name:        'resetwarn',
    aliases:     ['clearwarn'],
    description: 'Reset all warnings for a member. Usage: .resetwarn @user',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args }) {
      const target = firstMentionedOrArg(ctx, args);
      if (!target) {
        await reply(sock, ctx, '❌ Mention or provide the phone number to reset warnings.');
        return;
      }

      await resetWarnings(ctx.jid, normaliseJid(target));
      await sock.sendMessage(ctx.jid, {
        text:     `✅ Warnings for ${mentionJid(target)} have been reset.`,
        mentions: [normaliseJid(target)],
      });
    },
  },

  /* ── groupopen ── */
  {
    name:        'groupopen',
    aliases:     ['open'],
    description: 'Allow all members to send messages in the group.',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    10,
    async execute({ sock, ctx }) {
      if (!await requireBotAdmin(sock, ctx)) return;
      try {
        await sock.groupSettingUpdate(ctx.jid, 'not_announcement');
        await reply(sock, ctx, '✅ Group is now *open* — all members can send messages.');
      } catch (err) {
        await reply(sock, ctx, `❌ Failed: ${err.message}`);
      }
    },
  },

  /* ── groupclose ── */
  {
    name:        'groupclose',
    aliases:     ['close'],
    description: 'Restrict sending messages to admins only.',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    10,
    async execute({ sock, ctx }) {
      if (!await requireBotAdmin(sock, ctx)) return;
      try {
        await sock.groupSettingUpdate(ctx.jid, 'announcement');
        await reply(sock, ctx, '🔒 Group is now *closed* — only admins can send messages.');
      } catch (err) {
        await reply(sock, ctx, `❌ Failed: ${err.message}`);
      }
    },
  },

  /* ── setname ── */
  {
    name:        'setname',
    aliases:     [],
    description: 'Change the group subject/name. Usage: .setname <name>',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    10,
    async execute({ sock, ctx, args }) {
      if (!await requireBotAdmin(sock, ctx)) return;

      const name = args.join(' ').trim();
      if (!name || name.length > 100) {
        await reply(sock, ctx, '❌ Provide a valid group name (1–100 characters).');
        return;
      }

      try {
        await sock.groupUpdateSubject(ctx.jid, name);
        await reply(sock, ctx, `✅ Group name updated to: *${name}*`);
      } catch (err) {
        await reply(sock, ctx, `❌ Failed: ${err.message}`);
      }
    },
  },

  /* ── setdesc ── */
  {
    name:        'setdesc',
    aliases:     [],
    description: 'Change the group description. Usage: .setdesc <description>',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    10,
    async execute({ sock, ctx, args }) {
      if (!await requireBotAdmin(sock, ctx)) return;

      const desc = args.join(' ').trim();
      try {
        await sock.groupUpdateDescription(ctx.jid, desc || '');
        await reply(sock, ctx, desc ? `✅ Group description updated.` : '✅ Group description cleared.');
      } catch (err) {
        await reply(sock, ctx, `❌ Failed: ${err.message}`);
      }
    },
  },

  /* ── invite ── */
  {
    name:        'invite',
    aliases:     ['invitelink'],
    description: 'Get the group invite link.',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    10,
    async execute({ sock, ctx }) {
      if (!await requireBotAdmin(sock, ctx)) return;
      try {
        const code = await sock.groupInviteCode(ctx.jid);
        await reply(sock, ctx, `🔗 *Invite Link*\nhttps://chat.whatsapp.com/${code}`);
      } catch (err) {
        await reply(sock, ctx, `❌ Failed to get invite link: ${err.message}`);
      }
    },
  },

  /* ── revokeinvite ── */
  {
    name:        'revokeinvite',
    aliases:     ['resetlink'],
    description: 'Revoke and regenerate the group invite link.',
    category:    'Admin',
    groupOnly:   true,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    20,
    async execute({ sock, ctx }) {
      if (!await requireBotAdmin(sock, ctx)) return;
      try {
        const code = await sock.groupRevokeInvite(ctx.jid);
        await reply(sock, ctx, `✅ Invite link revoked.\n🔗 New link: https://chat.whatsapp.com/${code}`);
      } catch (err) {
        await reply(sock, ctx, `❌ Failed to revoke invite link: ${err.message}`);
      }
    },
  },

];

export default commands;
