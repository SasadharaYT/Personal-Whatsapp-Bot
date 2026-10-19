/**
 * commands/media.js — YouTube media download commands via yt-dlp.
 *
 * Commands: ytinfo, ytmp4, ytmp3, ythelp
 */

import fs from 'fs/promises';
import { getVideoInfo, download } from '../services/media-downloader.js';
import { cleanupFile } from '../services/safety.js';
import { reply, sendVideo, sendAudio } from '../utils/message.js';
import config from '../config.js';

/* ── Helpers ──────────────────────────────────────────────────────────── */

function extractUrl(ctx, args) {
  const argText = args[0]?.trim();
  if (argText) return argText;
  const quoted = ctx.raw?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quoted) {
    const text = quoted.conversation || quoted.extendedTextMessage?.text || '';
    const match = text.match(/https?:\/\/[^\s]+/);
    if (match) return match[0];
  }
  return '';
}

/* ── Command definitions ──────────────────────────────────────────────── */

const commands = [

  /* ── ytinfo ── */
  {
    name:        'ytinfo',
    aliases:     ['yinfo', 'videoinfo'],
    description: 'Get YouTube video information, duration, and channel metadata.',
    category:    'Media',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args, prefix }) {
      const url = extractUrl(ctx, args);
      if (!url) {
        await reply(sock, ctx, `💡 *Usage:* \`${prefix}ytinfo <youtube_url>\` or reply to a message containing a YouTube link.`);
        return;
      }

      await reply(sock, ctx, '🔍 _Fetching video details..._');
      const res = await getVideoInfo(url);

      if (!res.success) {
        await reply(sock, ctx, `⚠️ ${res.error}`);
        return;
      }

      const { info } = res;
      const lines = [
        `🎬 *${info.title}*`,
        '',
        `👤 *Channel:* ${info.channel}`,
        `⏱ *Duration:* ${info.durationStr}`,
        info.viewCount ? `👁 *Views:* ${info.viewCount.toLocaleString()}` : null,
        info.uploadDate ? `📅 *Uploaded:* ${info.uploadDate}` : null,
        info.isLive ? '🔴 *Status:* Live stream' : null,
        '',
        `💡 Download with \`${prefix}ytmp4 ${url}\` (video) or \`${prefix}ytmp3 ${url}\` (audio).`,
      ].filter(Boolean);

      await reply(sock, ctx, lines.join('\n'));
    },
  },

  /* ── ytmp4 ── */
  {
    name:        'ytmp4',
    aliases:     ['ytvideo', 'ytdl', 'ytdlp'],
    description: 'Download a YouTube video (max 50MB) and send as MP4.',
    category:    'Media',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    15,
    async execute({ sock, ctx, args, prefix }) {
      const url = extractUrl(ctx, args);
      if (!url) {
        await reply(sock, ctx, `💡 *Usage:* \`${prefix}ytmp4 <youtube_url>\`\nExample: \`${prefix}ytmp4 https://youtube.com/watch?v=...\``);
        return;
      }

      await reply(sock, ctx, `⏳ _Processing video download (max ${config.maxMediaSizeMb || 50}MB)... This may take a minute._`);

      let res;
      try {
        res = await download(url, 'video', ctx.sender);

        if (!res.success) {
          await reply(sock, ctx, `⚠️ ${res.error}`);
          return;
        }

        const buffer = await fs.readFile(res.filePath);
        const mb = (buffer.length / (1024 * 1024)).toFixed(1);
        await sendVideo(sock, ctx, buffer, `🎬 *Downloaded via ${config.botName}* (${mb} MB)`);

      } catch (err) {
        await reply(sock, ctx, `⚠️ Failed to send video: ${err.message}`);
      } finally {
        if (res?.filePath) {
          await cleanupFile(res.filePath);
        }
      }
    },
  },

  /* ── ytmp3 ── */
  {
    name:        'ytmp3',
    aliases:     ['ytaudio', 'yta'],
    description: 'Download audio from YouTube and send as MP3.',
    category:    'Media',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    15,
    async execute({ sock, ctx, args, prefix }) {
      const url = extractUrl(ctx, args);
      if (!url) {
        await reply(sock, ctx, `💡 *Usage:* \`${prefix}ytmp3 <youtube_url>\`\nExample: \`${prefix}ytmp3 https://youtube.com/watch?v=...\``);
        return;
      }

      await reply(sock, ctx, `🎵 _Extracting audio (max ${config.maxMediaSizeMb || 50}MB)... Please wait._`);

      let res;
      try {
        res = await download(url, 'audio', ctx.sender);

        if (!res.success) {
          await reply(sock, ctx, `⚠️ ${res.error}`);
          return;
        }

        const buffer = await fs.readFile(res.filePath);
        await sendAudio(sock, ctx, buffer);

      } catch (err) {
        await reply(sock, ctx, `⚠️ Failed to send audio: ${err.message}`);
      } finally {
        if (res?.filePath) {
          await cleanupFile(res.filePath);
        }
      }
    },
  },

  /* ── ythelp ── */
  {
    name:        'ythelp',
    aliases:     ['mediahelp'],
    description: 'Show help and usage guide for YouTube media downloader commands.',
    category:    'Media',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, prefix }) {
      const lines = [
        '🎬 *YouTube Media Downloader Help*',
        '',
        `\`${prefix}ytinfo <url>\` — View video info, length, and details`,
        `\`${prefix}ytmp4 <url>\` — Download video as MP4`,
        `\`${prefix}ytmp3 <url>\` — Download audio as MP3`,
        '',
        '*Rules & Limits:*',
        `• Max file size: ${config.maxMediaSizeMb || 50} MB`,
        '• Cooldown: 30 seconds between downloads per user',
        '• Max concurrent downloads: 2 at a time',
        '• Only public YouTube links are supported',
        '• Requires yt-dlp and ffmpeg installed on host machine',
      ];
      await reply(sock, ctx, lines.join('\n'));
    },
  },

];

export default commands;
