/**
 * safety.js — Input validation, SSRF prevention, and security utilities.
 *
 * Shared safety module used by AI, media, and image services.
 * Provides URL validation, file signature checks, SSRF blocking,
 * input sanitisation, and temp-file management.
 */

import { URL } from 'url';
import fs from 'fs/promises';
import path from 'path';
import logger from './logger.js';

/* ── Allowed YouTube domains ───────────────────────────────────────────── */

const YOUTUBE_DOMAINS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtu.be', 'www.youtu.be',
  'youtube-nocookie.com', 'www.youtube-nocookie.com',
  'music.youtube.com',
]);

/* ── Private / reserved IP ranges for SSRF blocking ────────────────────── */

const PRIVATE_IP_PATTERNS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^0\./, /^169\.254\./, /^224\./, /^240\./, /^255\./,
  /^::1$/, /^fc/i, /^fd/i, /^fe80/i, /^ff/i,
  /^localhost$/i,
];

/* ── File magic bytes ──────────────────────────────────────────────────── */

const MAGIC_BYTES = {
  'image/jpeg':  [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png':   [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
  'image/gif':   [Buffer.from('GIF87a'), Buffer.from('GIF89a')],
  'image/webp':  [Buffer.from('RIFF')],
  'video/mp4':   [Buffer.from([0x00, 0x00, 0x00])],
  'audio/mpeg':  [Buffer.from([0xFF, 0xFB]), Buffer.from([0xFF, 0xF3]),
                  Buffer.from([0xFF, 0xF2]), Buffer.from('ID3')],
  'audio/mp4':   [Buffer.from([0x00, 0x00, 0x00])],
  'audio/ogg':   [Buffer.from('OggS')],
};

/* ── Input length limits ───────────────────────────────────────────────── */

export const INPUT_LIMITS = {
  AI_INPUT_MAX_LENGTH:       4000,
  AI_OUTPUT_MAX_LENGTH:      4096,
  URL_MAX_LENGTH:            2048,
  SEARCH_QUERY_MAX_LENGTH:   200,
  TRANSLATE_TEXT_MAX_LENGTH:  3000,
  MAX_HISTORY_MESSAGES:      20,
  MAX_HISTORY_TOKENS_APPROX: 8000,
};

/* ── YouTube URL validation ────────────────────────────────────────────── */

/**
 * Validate that a URL belongs to a supported YouTube domain.
 * Rejects arbitrary URLs, local file paths, and unsupported schemes.
 */
export function isValidYouTubeUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  if (urlStr.length > INPUT_LIMITS.URL_MAX_LENGTH) return false;

  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    return YOUTUBE_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Extract video ID from a validated YouTube URL.
 * Returns null if extraction fails.
 */
export function extractYouTubeVideoId(urlStr) {
  if (!isValidYouTubeUrl(urlStr)) return null;
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');

    if (hostname === 'youtu.be') {
      return url.pathname.slice(1).split('/')[0] || null;
    }
    if (hostname.includes('youtube.com') || hostname.includes('music.youtube.com')) {
      if (url.pathname.startsWith('/shorts/')) {
        return url.pathname.split('/shorts/')[1]?.split('/')[0] || null;
      }
      return url.searchParams.get('v') || null;
    }
    return null;
  } catch {
    return null;
  }
}

/* ── SSRF prevention ───────────────────────────────────────────────────── */

/**
 * Check if hostname resolves to a private or reserved address.
 */
export function isPrivateOrReserved(hostname) {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();
  return PRIVATE_IP_PATTERNS.some(re => re.test(lower));
}

/**
 * Validate a URL is safe for server-side fetching (no SSRF).
 * Blocks private IPs, credentials in URLs, and non-HTTP(S) schemes.
 */
export function isSafeUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  if (urlStr.length > INPUT_LIMITS.URL_MAX_LENGTH) return false;

  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (isPrivateOrReserved(url.hostname)) return false;
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}

/* ── Input sanitisation ────────────────────────────────────────────────── */

/**
 * Sanitise and trim user input text to a maximum length.
 */
export function sanitizeInput(text, maxLength = INPUT_LIMITS.AI_INPUT_MAX_LENGTH) {
  if (!text || typeof text !== 'string') return '';
  return text.trim().slice(0, maxLength);
}

/**
 * Truncate text to a maximum length with ellipsis.
 */
export function truncateText(text, maxLength = 500) {
  if (!text || text.length <= maxLength) return text || '';
  return text.slice(0, maxLength - 3) + '...';
}

/* ── File validation ───────────────────────────────────────────────────── */

/**
 * Validate file signature (magic bytes) matches expected MIME types.
 * @param {Buffer} buffer - First few bytes of the file
 * @param {string[]} expectedTypes - Allowed MIME types (empty = any known type)
 * @returns {{ valid: boolean, detectedType: string|null }}
 */
export function validateFileSignature(buffer, expectedTypes = []) {
  if (!buffer || buffer.length < 4) return { valid: false, detectedType: null };

  for (const [mime, signatures] of Object.entries(MAGIC_BYTES)) {
    for (const sig of signatures) {
      if (buffer.length >= sig.length && buffer.subarray(0, sig.length).equals(sig)) {
        return {
          valid: expectedTypes.length === 0 || expectedTypes.includes(mime),
          detectedType: mime,
        };
      }
    }
  }

  return { valid: false, detectedType: null };
}

/* ── Temp-file management ──────────────────────────────────────────────── */

/**
 * Generate a safe temporary file path with a random name.
 * Prevents user control over the output path.
 */
export function safeTempPath(prefix, ext, tempDir) {
  const safeName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const safeExt  = ext.replace(/[^a-zA-Z0-9.]/g, '');
  return path.join(tempDir, `${safeName}${safeExt}`);
}

/**
 * Safely delete a temporary file. Silently ignores ENOENT.
 */
export async function cleanupFile(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn({ err, filePath }, 'Failed to clean up temp file');
    }
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureTempDir(tempDir) {
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Check available disk space on the partition containing `dir`.
 * Returns available bytes, or Infinity if the check is unsupported.
 */
export async function getAvailableDiskSpace(dir) {
  try {
    const stats = await fs.statfs(dir);
    return BigInt(stats.bavail) * BigInt(stats.bsize);
  } catch {
    // statfs may not be available on all Node builds
    return Infinity;
  }
}

/**
 * Clean all files in a temp directory that match a prefix.
 * Used during startup to remove stale downloads.
 */
export async function cleanupStaleFiles(tempDir, maxAgeMs = 3_600_000) {
  try {
    const files = await fs.readdir(tempDir);
    const now   = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const filePath = path.join(tempDir, file);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
          await fs.unlink(filePath);
          cleaned++;
        }
      } catch { /* skip individual file errors */ }
    }

    if (cleaned > 0) {
      logger.info({ cleaned, tempDir }, 'Cleaned up stale temp files');
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn({ err, tempDir }, 'Failed to clean stale temp files');
    }
  }
}
