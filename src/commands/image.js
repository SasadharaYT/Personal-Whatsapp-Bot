/**
 * commands/image.js — Image & Wallpaper search and download via Pexels.
 *
 * Commands: wallpaper, image, imageinfo, imagehelp
 */

import fs from 'fs/promises';
import { searchPhotos, getRandomPhotos, downloadImage, getCategories, getImageServiceStatus } from '../services/image-search.js';
import { cleanupFile } from '../services/safety.js';
import { reply, sendImage } from '../utils/message.js';
import config from '../config.js';

/* ── Command definitions ──────────────────────────────────────────────── */

const commands = [

  /* ── wallpaper ── */
  {
    name:        'wallpaper',
    aliases:     ['wp', 'wall'],
    description: 'Search for high-resolution phone wallpapers and send directly.',
    category:    'Image',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    8,
    async execute({ sock, ctx, args, prefix }) {
      const query = args.join(' ').trim() || 'nature';

      await reply(sock, ctx, `🖼 _Searching for "${query}" wallpaper..._`);

      const searchRes = await searchPhotos(query, ctx.sender, {
        count:       5,
        orientation: 'portrait',
      });

      if (!searchRes.success) {
        await reply(sock, ctx, `⚠️ ${searchRes.error}`);
        return;
      }

      // Pick a random one from the top results for variety
      const photo = searchRes.photos[Math.floor(Math.random() * searchRes.photos.length)];
      let downloadRes;

      try {
        downloadRes = await downloadImage(photo.src, config.tempDir);

        if (!downloadRes.success) {
          await reply(sock, ctx, `⚠️ ${downloadRes.error}`);
          return;
        }

        const buffer = await fs.readFile(downloadRes.filePath);
        const caption = [
          `🖼 *${photo.alt || query}*`,
          `📸 Photo by *${photo.photographer}* on ${photo.provider || 'Pixabay'}`,
          photo.photographerUrl ? `🔗 ${photo.photographerUrl}` : '',
        ].filter(Boolean).join('\n');

        await sendImage(sock, ctx, buffer, caption);

      } catch (err) {
        await reply(sock, ctx, `⚠️ Failed to send wallpaper: ${err.message}`);
      } finally {
        if (downloadRes?.filePath) {
          await cleanupFile(downloadRes.filePath);
        }
      }
    },
  },

  /* ── image ── */
  {
    name:        'image',
    aliases:     ['img', 'pic', 'photo'],
    description: 'Search for high-quality photos on Pexels.',
    category:    'Image',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    8,
    async execute({ sock, ctx, args, prefix }) {
      if (args.length === 0) {
        await reply(
          sock,
          ctx,
          `💡 *Usage:* \`${prefix}image <search query>\`\nExample: \`${prefix}image cyberpunk city\``
        );
        return;
      }

      const query = args.join(' ').trim();
      await reply(sock, ctx, `🔍 _Searching photos for "${query}"..._`);

      const searchRes = await searchPhotos(query, ctx.sender, {
        count:       5,
        orientation: 'landscape',
      });

      if (!searchRes.success) {
        await reply(sock, ctx, `⚠️ ${searchRes.error}`);
        return;
      }

      const photo = searchRes.photos[0];
      let downloadRes;

      try {
        downloadRes = await downloadImage(photo.src, config.tempDir);

        if (!downloadRes.success) {
          await reply(sock, ctx, `⚠️ ${downloadRes.error}`);
          return;
        }

        const buffer = await fs.readFile(downloadRes.filePath);
        const caption = [
          `📸 *${photo.alt || query}*`,
          `👤 By: *${photo.photographer}*`,
          `🔗 ${photo.url}`,
        ].join('\n');

        await sendImage(sock, ctx, buffer, caption);

      } catch (err) {
        await reply(sock, ctx, `⚠️ Failed to send image: ${err.message}`);
      } finally {
        if (downloadRes?.filePath) {
          await cleanupFile(downloadRes.filePath);
        }
      }
    },
  },

  /* ── imageinfo ── */
  {
    name:        'imageinfo',
    aliases:     ['curated', 'randomimage'],
    description: 'Get a curated high-resolution random photo and photographer credit.',
    category:    'Image',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    8,
    async execute({ sock, ctx, prefix }) {
      await reply(sock, ctx, '🎲 _Finding a curated photo..._');

      const res = await getRandomPhotos(ctx.sender, 1);
      if (!res.success) {
        await reply(sock, ctx, `⚠️ ${res.error}`);
        return;
      }

      const photo = res.photos[0];
      let downloadRes;

      try {
        downloadRes = await downloadImage(photo.src, config.tempDir);

        if (!downloadRes.success) {
          await reply(sock, ctx, `⚠️ ${downloadRes.error}`);
          return;
        }

        const buffer = await fs.readFile(downloadRes.filePath);
        const caption = [
          `🌟 *Curated Photo*`,
          photo.alt ? `📝 "${photo.alt}"` : '',
          `📸 By: *${photo.photographer}*`,
          `📐 Resolution: ${photo.width} × ${photo.height}`,
          `🔗 ${photo.url}`,
        ].filter(Boolean).join('\n');

        await sendImage(sock, ctx, buffer, caption);

      } catch (err) {
        await reply(sock, ctx, `⚠️ Failed to send curated photo: ${err.message}`);
      } finally {
        if (downloadRes?.filePath) {
          await cleanupFile(downloadRes.filePath);
        }
      }
    },
  },

  /* ── imagehelp ── */
  {
    name:        'imagehelp',
    aliases:     ['wallpaperhelp'],
    description: 'Show help and popular categories for wallpaper and image search.',
    category:    'Image',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, prefix }) {
      const status = getImageServiceStatus();
      const categories = getCategories();

      const lines = [
        '🎨 *Wallpaper & Image Search Help*',
        `• Status: ${status.configured ? `✅ Active (${status.provider} API)` : '⚠️ API Key Not Set'}`,
        '',
        `\`${prefix}wallpaper <category>\` — Search portrait phone wallpapers`,
        `\`${prefix}image <query>\` — Search general high-res photos`,
        `\`${prefix}imageinfo\` — Get a random curated photo`,
        '',
        '*Popular categories:*',
        categories.map(c => `• \`${prefix}wallpaper ${c}\``).join('\n'),
        '',
        `_Photos provided freely by ${status.provider || 'Pixabay'} with photographer attribution._`,
      ];

      await reply(sock, ctx, lines.join('\n'));
    },
  },

];

export default commands;
