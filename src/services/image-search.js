/**
 * image-search.js — Pexels image search and download service.
 *
 * Wraps the official Pexels API SDK with:
 *  - Search and curated/random photo retrieval
 *  - SSRF-safe image downloading with size and type validation
 *  - Rate limiting and timeouts
 *  - Proper attribution and licensing information
 */

import { createClient } from 'pexels';
import fs from 'fs/promises';
import config from '../config.js';
import logger from './logger.js';
import { imageLimiter } from './rate-limiter.js';
import {
  isSafeUrl, sanitizeInput, INPUT_LIMITS,
  safeTempPath, cleanupFile, ensureTempDir, validateFileSignature,
} from './safety.js';

/* ── State ─────────────────────────────────────────────────────────────── */

/** @type {import('pexels').Client|null} */
let client   = null;
let initError = null;

const CATEGORIES = [
  'nature', 'anime', 'cars', 'space', 'technology', 'landscape',
  'city', 'animals', 'abstract', 'minimal', 'dark', 'ocean',
  'mountain', 'forest', 'sunset', 'architecture', 'flowers',
];

/* ── Initialisation ────────────────────────────────────────────────────── */

function ensureClient() {
  if (client) return;

  if (!config.imageProviderApiKey) {
    initError = 'PEXELS_API_KEY is not configured. Get a free key at https://www.pexels.com/api/ and set PEXELS_API_KEY in your .env file.';
    return;
  }

  try {
    client = createClient(config.imageProviderApiKey);
    initError = null;
    logger.info('Pexels image search service initialised');
  } catch (err) {
    initError = `Failed to initialise Pexels client: ${err.message}`;
    logger.error({ err }, 'Pexels init error');
  }
}

/* ── Search ─────────────────────────────────────────────────────────────── */

/**
 * Search for photos on Pexels.
 *
 * @param {string} query     - Search term
 * @param {string} senderJid - User JID for rate limiting
 * @param {object} [opts]
 * @param {number} [opts.count=5]             - Results per page
 * @param {'portrait'|'landscape'|'square'} [opts.orientation='portrait']
 * @param {boolean} [opts.highRes=false]      - Prefer large2x resolution
 * @returns {{ success, photos?, totalResults?, error? }}
 */
export async function searchPhotos(query, senderJid, opts = {}) {
  ensureClient();
  if (initError)           return { success: false, error: initError };
  if (!config.mediaEnabled) return { success: false, error: 'Media features are currently disabled.' };

  // Rate limit
  const rl = imageLimiter.check(senderJid);
  if (!rl.allowed) {
    const wait = Math.ceil(rl.retryAfterMs / 1000);
    return { success: false, error: `⏳ Rate limit reached. Please wait ${wait}s.` };
  }

  const sanitized = sanitizeInput(query, INPUT_LIMITS.SEARCH_QUERY_MAX_LENGTH);
  if (!sanitized) return { success: false, error: 'Please provide a search term.' };

  try {
    const perPage     = opts.count || 5;
    const orientation = opts.orientation || 'portrait';

    const result = await Promise.race([
      client.photos.search({ query: sanitized, per_page: perPage, orientation }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Search timeout')), 15_000)),
    ]);

    if (!result?.photos?.length) {
      return { success: false, error: `No images found for "${sanitized}". Try different keywords.` };
    }

    const photos = result.photos.map(normalisePhoto);
    return { success: true, photos, totalResults: result.total_results };

  } catch (err) {
    logger.error({ err, query: sanitized }, 'Pexels search error');
    return { success: false, error: classifyPexelsError(err) };
  }
}

/**
 * Get curated (random) photos from Pexels.
 */
export async function getRandomPhotos(senderJid, count = 1) {
  ensureClient();
  if (initError)           return { success: false, error: initError };
  if (!config.mediaEnabled) return { success: false, error: 'Media features are currently disabled.' };

  const rl = imageLimiter.check(senderJid);
  if (!rl.allowed) return { success: false, error: '⏳ Rate limit reached. Please wait.' };

  try {
    const page = Math.floor(Math.random() * 100) + 1;
    const result = await Promise.race([
      client.photos.curated({ per_page: count, page }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 15_000)),
    ]);

    if (!result?.photos?.length) {
      return { success: false, error: 'Could not fetch random images. Please try again.' };
    }

    return { success: true, photos: result.photos.map(normalisePhoto) };
  } catch (err) {
    logger.error({ err }, 'Pexels curated error');
    return { success: false, error: classifyPexelsError(err) };
  }
}

/* ── Download ──────────────────────────────────────────────────────────── */

/**
 * Download an image from Pexels to a temp file with validation.
 *
 * @param {object} photoSrc - Photo src object from normalised photo
 * @param {string} tempDir  - Temporary directory path
 * @returns {{ success, filePath?, mimeType?, size?, error? }}
 */
export async function downloadImage(photoSrc, tempDir) {
  // Prefer high-res variants
  const imageUrl = photoSrc.large2x || photoSrc.large || photoSrc.portrait || photoSrc.medium;

  if (!imageUrl || !isSafeUrl(imageUrl)) {
    return { success: false, error: 'Invalid or unsafe image URL.' };
  }

  await ensureTempDir(tempDir);
  const filePath = safeTempPath('wallpaper', '.jpg', tempDir);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let response;
    try {
      response = await fetch(imageUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'WhatsApp-Bot/1.0' },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return { success: false, error: `Image download failed (HTTP ${response.status}).` };
    }

    // Content-type check
    const ct = response.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) {
      return { success: false, error: 'Downloaded content is not an image.' };
    }

    // Content-length pre-check
    const maxBytes = (config.maxMediaSizeMb || 50) * 1024 * 1024;
    const cl = parseInt(response.headers.get('content-length') || '0', 10);
    if (cl > maxBytes) {
      return { success: false, error: `Image too large (${Math.round(cl / 1024 / 1024)}MB). Max: ${config.maxMediaSizeMb}MB.` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length > maxBytes) {
      return { success: false, error: `Image too large. Max: ${config.maxMediaSizeMb}MB.` };
    }

    // Validate magic bytes
    const sigCheck = validateFileSignature(buffer, ['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!sigCheck.valid) {
      return { success: false, error: 'Downloaded file does not appear to be a valid image.' };
    }

    await fs.writeFile(filePath, buffer);

    return {
      success:  true,
      filePath,
      mimeType: sigCheck.detectedType || ct,
      size:     buffer.length,
    };

  } catch (err) {
    await cleanupFile(filePath);

    if (err.name === 'AbortError') {
      return { success: false, error: 'Image download timed out.' };
    }

    logger.error({ err }, 'Image download error');
    return { success: false, error: 'Failed to download image.' };
  }
}

/* ── Utilities ─────────────────────────────────────────────────────────── */

/** Return the list of suggested search categories. */
export function getCategories() {
  return [...CATEGORIES];
}

/** Return service status (safe to display). */
export function getImageServiceStatus() {
  ensureClient();
  return {
    configured: !!config.imageProviderApiKey,
    provider:   'Pexels',
    error:      initError,
  };
}

/* ── Internal helpers ──────────────────────────────────────────────────── */

function normalisePhoto(p) {
  return {
    id:              p.id,
    width:           p.width,
    height:          p.height,
    photographer:    p.photographer,
    photographerUrl: p.photographer_url,
    url:             p.url,
    src: {
      original: p.src.original,
      large2x:  p.src.large2x,
      large:    p.src.large,
      medium:   p.src.medium,
      portrait: p.src.portrait,
    },
    alt:      p.alt || '',
    avgColor: p.avg_color,
  };
}

function classifyPexelsError(err) {
  const msg = err.message ?? '';
  if (msg.includes('timeout') || msg.includes('Timeout'))       return 'Image search timed out. Please try again.';
  if (msg.includes('401') || msg.includes('Unauthorized'))      return 'Image provider API key is invalid.';
  if (msg.includes('429') || msg.includes('Too Many Requests')) return 'Image search rate limit reached. Please try again later.';
  return 'Failed to search for images. Please try again.';
}
