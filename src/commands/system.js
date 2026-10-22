/**
 * commands/system.js — System health, media queue, and feature toggles.
 *
 * Commands: health, mediaqueue, cancelmedia, toggleai, togglemedia
 */

import os from 'os';
import config from '../config.js';
import { reply, formatUptime } from '../utils/message.js';
import { stats } from '../handler.js';
import { getStatus as getAiStatus, setAiForGroup, isAiEnabledForGroup } from '../services/ollama.js';
import { getActiveJobs, cancelJob, getDownloaderStatus } from '../services/media-downloader.js';
import { getAvailableDiskSpace } from '../services/safety.js';
import { getImageServiceStatus } from '../services/image-search.js';

/* ── Helpers ──────────────────────────────────────────────────────────── */

function formatBytes(bytes) {
  if (typeof bytes === 'bigint') bytes = Number(bytes);
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

/* ── Command definitions ──────────────────────────────────────────────── */

const commands = [

  /* ── health ── */
  {
    name:        'health',
    aliases:     ['syshealth', 'sys', 'systeminfo'],
    description: 'System health dashboard: memory, disk space, AI status, downloader status.',
    category:    'System',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    10,
    async execute({ sock, ctx }) {
      const mem = process.memoryUsage();
      const uptimeMs = Date.now() - stats.startTime;
      const diskSpace = await getAvailableDiskSpace(config.tempDir);
      const aiStatus = getAiStatus();
      const dlStatus = await getDownloaderStatus();
      const imgStatus = getImageServiceStatus();

      const lines = [
        `💻 *${config.botName} System Health*`,
        '',
        `⏱ *Uptime:* ${formatUptime(uptimeMs)}`,
        `🖥 *Platform:* ${os.type()} ${os.release()} (${os.arch()})`,
        `📦 *Node.js:* ${process.version}`,
        '',
        `🧠 *Memory Usage:*`,
        `  • RSS: ${formatBytes(mem.rss)}`,
        `  • Heap Used: ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`,
        `💾 *Disk Space Available:* ${formatBytes(diskSpace)}`,
        '',
        `🤖 *Ollama Cloud AI:* ${aiStatus.enabled && aiStatus.configured ? '🟢 Online' : '🔴 Offline'} (${aiStatus.model})`,
        `🎬 *yt-dlp:* ${dlStatus.ytDlpInstalled ? '🟢 Installed' : '🔴 Not Found'}`,
        `🎵 *ffmpeg:* ${dlStatus.ffmpegInstalled ? '🟢 Installed' : '⚠️ Not Found (audio limited)'}`,
        `🖼 *Image Search:* ${imgStatus.configured ? '🟢 Configured' : '⚠️ No API Key'}`,
        '',
        `📊 *Stats:*`,
        `  • Messages processed: ${stats.messagesProcessed}`,
        `  • Commands executed: ${stats.commandsExecuted}`,
        `  • Active download jobs: ${dlStatus.activeJobs}`,
        `  • Errors: ${stats.errors}`,
      ];

      await reply(sock, ctx, lines.join('\n'));
    },
  },

  /* ── mediaqueue ── */
  {
    name:        'mediaqueue',
    aliases:     ['queue', 'jobs'],
    description: 'View active media download jobs and queue status.',
    category:    'System',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, prefix }) {
      const jobs = getActiveJobs();

      if (jobs.length === 0) {
        await reply(sock, ctx, '📋 *Media Queue:* No active downloads at the moment.');
        return;
      }

      const lines = [
        `📋 *Media Download Queue (${jobs.length} active):*`,
        '',
      ];

      for (const job of jobs) {
        const sender = job.sender.split('@')[0];
        lines.push(`• Job ID: \`${job.id}\` | Type: ${job.type} | User: @${sender} | Status: ${job.status} (${job.progress}) | Elapsed: ${job.elapsed}`);
      }

      lines.push('');
      lines.push(`To cancel a job, use \`${prefix}cancelmedia <job_id>\`.`);

      await reply(sock, ctx, lines.join('\n'));
    },
  },

  /* ── cancelmedia ── */
  {
    name:        'cancelmedia',
    aliases:     ['canceljob', 'abortmedia'],
    description: 'Cancel a running media download job by ID.',
    category:    'System',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    3,
    async execute({ sock, ctx, args, isOwner, isAdmin, prefix }) {
      const jobId = args[0]?.trim();
      if (!jobId) {
        await reply(sock, ctx, `💡 *Usage:* \`${prefix}cancelmedia <job_id>\`\nUse \`${prefix}mediaqueue\` to view running job IDs.`);
        return;
      }

      const jobs = getActiveJobs();
      const targetJob = jobs.find(j => j.id === jobId);

      if (!targetJob) {
        await reply(sock, ctx, `⚠️ Job \`${jobId}\` was not found or is no longer running.`);
        return;
      }

      // Check permission: creator, admin, or owner can cancel
      if (targetJob.sender !== ctx.sender && !isOwner && !isAdmin) {
        await reply(sock, ctx, '❌ You can only cancel your own downloads unless you are an admin or owner.');
        return;
      }

      const res = cancelJob(jobId);
      if (res.success) {
        await reply(sock, ctx, `✅ ${res.message}`);
      } else {
        await reply(sock, ctx, `⚠️ ${res.error}`);
      }
    },
  },

  /* ── toggleai ── */
  {
    name:        'toggleai',
    aliases:     ['enableai', 'disableai'],
    description: 'Enable or disable AI commands in this group or globally.',
    category:    'System',
    groupOnly:   false,
    adminOnly:   true,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args, isOwner, prefix }) {
      if (!ctx.isGroup && !isOwner) {
        await reply(sock, ctx, '❌ This command can only be used in groups or by the bot owner in DMs.');
        return;
      }

      const action = args[0]?.toLowerCase();
      if (!action || !['on', 'off', 'status'].includes(action)) {
        await reply(
          sock,
          ctx,
          `💡 *Usage:* \`${prefix}toggleai on|off|status\`\n` +
          `Turns AI commands on or off for this group.`
        );
        return;
      }

      if (ctx.isGroup) {
        if (action === 'status') {
          const enabled = await isAiEnabledForGroup(ctx.chat);
          await reply(sock, ctx, `🤖 AI in this group is currently: *${enabled ? '🟢 Enabled' : '🔴 Disabled'}*`);
          return;
        }

        const enable = action === 'on';
        await setAiForGroup(ctx.chat, enable);
        await reply(sock, ctx, `🤖 AI commands are now *${enable ? '🟢 Enabled' : '🔴 Disabled'}* for this group.`);
      } else if (isOwner) {
        if (action === 'status') {
          await reply(sock, ctx, `🤖 Global AI is currently: *${config.aiEnabled ? '🟢 Enabled' : '🔴 Disabled'}*`);
          return;
        }
        config.aiEnabled = (action === 'on');
        await reply(sock, ctx, `🤖 Global AI is now *${config.aiEnabled ? '🟢 Enabled' : '🔴 Disabled'}*.`);
      }
    },
  },

  /* ── togglemedia ── */
  {
    name:        'togglemedia',
    aliases:     ['enablemedia', 'disablemedia'],
    description: 'Enable or disable media downloading bot-wide (Owner only).',
    category:    'System',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   true,
    cooldown:    3,
    async execute({ sock, ctx, args, prefix }) {
      const action = args[0]?.toLowerCase();
      if (!action || !['on', 'off', 'status'].includes(action)) {
        await reply(sock, ctx, `💡 *Usage:* \`${prefix}togglemedia on|off|status\``);
        return;
      }

      if (action === 'status') {
        await reply(sock, ctx, `🎬 Media downloads are currently: *${config.mediaEnabled ? '🟢 Enabled' : '🔴 Disabled'}*`);
        return;
      }

      config.mediaEnabled = (action === 'on');
      await reply(sock, ctx, `🎬 Media downloads are now *${config.mediaEnabled ? '🟢 Enabled' : '🔴 Disabled'}*.`);
    },
  },

];

export default commands;
