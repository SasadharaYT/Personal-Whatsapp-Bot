/**
 * image-search.js — Pixabay and Pexels image search and download service.
 *
 * Supports:
 *  - Pixabay API (primary/default: instant free API key from https://pixabay.com/api/docs/)
 *  - Pexels API (legacy fallback if PEXELS_API_KEY is provided)
 *  - High-res photo and wallpaper retrieval (portrait/vertical & landscape/horizontal)
 *  - SSRF-safe image downloading with size and magic-byte validation
 *  - Token-bucket rate limiting and timeouts
 *  - Photographer attribution and direct source links
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
let pexelsClient = null;
let initError    = null;

const CATEGORIES = [
  'nature', 'anime', 'cars', 'space', 'technology', 'landscape',
  'city', 'animals', 'abstract', 'minimal', 'dark', 'ocean',
  'mountain', 'forest', 'sunset', 'architecture', 'flowers',
];

/* ── Provider detection ────────────────────────────────────────────────── */

/**
 * Determine active provider ('pixabay' | 'pexels').
 */
export function getActiveProvider() {
  if (config.imageProvider === 'pexels' && config.pexelsApiKey) {
    return 'pexels';
  }
  if (config.pixabayApiKey) {
    return 'pixabay';
  }
  if (config.pexelsApiKey) {
    return 'pexels';
  }
  return config.imageProvider || 'pixabay';
}

function getApiKey() {
  const provider = getActiveProvider();
  if (provider === 'pixabay') {
    return config.pixabayApiKey || config.imageProviderApiKey;
  }
  return config.pexelsApiKey || config.imageProviderApiKey;
}

/* ── Initialisation ────────────────────────────────────────────────────── */

function ensureReady() {
  const provider = getActiveProvider();
  const apiKey   = getApiKey();

  if (!apiKey) {
    initError = provider === 'pixabay'
      ? 'PIXABAY_API_KEY is not configured. Get a free instant API key at https://pixabay.com/api/docs/ (no waiting/approval) and set PIXABAY_API_KEY in your .env file.'
      : 'PEXELS_API_KEY is not configured. Set PEXELS_API_KEY or switch to PIXABAY_API_KEY in your .env file.';
    return;
  }

  if (provider === 'pexels' && !pexelsClient) {
    try {
      pexelsClient = createClient(apiKey);
      initError = null;
      logger.info('Pexels image search service initialised');
    } catch (err) {
      initError = `Failed to initialise Pexels client: ${err.message}`;
      logger.error({ err }, 'Pexels init error');
    }
    return;
  }

  initError = null;
}

/* ── Search ─────────────────────────────────────────────────────────────── */

/**
 * Search for photos on Pixabay or Pexels.
 *
 * @param {string} query     - Search term
 * @param {string} senderJid - User JID for rate limiting
 * @param {object} [opts]
 * @param {number} [opts.count=5]             - Results per page
 * @param {'portrait'|'landscape'|'square'} [opts.orientation='portrait']
 * @param {boolean} [opts.highRes=false]      - Prefer large2x resolution
 * @returns {Promise<{ success, photos?, totalResults?, provider?, error? }>}
 */
export async function searchPhotos(query, senderJid, opts = {}) {
  ensureReady();
  if (initError)            return { success: false, error: initError };
  if (!config.mediaEnabled) return { success: false, error: 'Media features are currently disabled.' };

  // Rate limit
  const rl = imageLimiter.check(senderJid);
  if (!rl.allowed) {
    const wait = Math.ceil(rl.retryAfterMs / 1000);
    return { success: false, error: `⏳ Rate limit reached. Please wait ${wait}s.` };
  }

  const sanitized = sanitizeInput(query, INPUT_LIMITS.SEARCH_QUERY_MAX_LENGTH);
  if (!sanitized) return { success: false, error: 'Please provide a search term.' };

  const provider = getActiveProvider();

  if (provider === 'pixabay') {
    return searchPixabay(sanitized, opts);
  }
  return searchPexels(sanitized, opts);
}

/** Pixabay Search */
async function searchPixabay(query, opts) {
  const apiKey = getApiKey();
  const perPage = Math.min(Math.max(opts.count || 5, 3), 50);

  // Pixabay orientation: "all", "horizontal", "vertical"
  let orientation = 'all';
  if (opts.orientation === 'portrait') orientation = 'vertical';
  if (opts.orientation === 'landscape') orientation = 'horizontal';

  const params = new URLSearchParams({
    key: apiKey,
    q: query.slice(0, 100),
    image_type: 'photo',
    orientation,
    per_page: String(perPage),
    safesearch: 'true',
  });

  const url = `https://pixabay.com/api/?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WhatsApp-Bot/1.0' },
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      if (response.status === 400 || response.status === 429) {
        return { success: false, error: 'Pixabay rate limit reached or invalid search parameters.' };
      }
      return { success: false, error: `Pixabay API returned error HTTP ${response.status}.` };
    }

    const data = await response.json();

    if (!data?.hits?.length) {
      return { success: false, error: `No images found for "${query}". Try different keywords.` };
    }

    const photos = data.hits.map(normalisePixabayPhoto);
    return { success: true, photos, totalResults: data.totalHits || data.total, provider: 'Pixabay' };

  } catch (err) {
    logger.error({ err, query }, 'Pixabay search error');
    if (err.name === 'AbortError') return { success: false, error: 'Image search timed out. Please try again.' };
    return { success: false, error: 'Failed to search for images on Pixabay.' };
  }
}

/** Pexels Search */
async function searchPexels(query, opts) {
  try {
    const perPage     = opts.count || 5;
    const orientation = opts.orientation || 'portrait';

    const result = await Promise.race([
      pexelsClient.photos.search({ query, per_page: perPage, orientation }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Search timeout')), 15_000)),
    ]);

    if (!result?.photos?.length) {
      return { success: false, error: `No images found for "${query}". Try different keywords.` };
    }

    const photos = result.photos.map(normalisePexelsPhoto);
    return { success: true, photos, totalResults: result.total_results, provider: 'Pexels' };

  } catch (err) {
    logger.error({ err, query }, 'Pexels search error');
    return { success: false, error: classifyImageError(err) };
  }
}

/* ── Curated / Random ──────────────────────────────────────────────────── */

/**
 * Get curated (random) photos from active provider.
 */
export async function getRandomPhotos(senderJid, count = 1) {
  ensureReady();
  if (initError)            return { success: false, error: initError };
  if (!config.mediaEnabled) return { success: false, error: 'Media features are currently disabled.' };

  const rl = imageLimiter.check(senderJid);
  if (!rl.allowed) return { success: false, error: '⏳ Rate limit reached. Please wait.' };

  const provider = getActiveProvider();

  if (provider === 'pixabay') {
    return getRandomPixabay(count);
  }
  return getRandomPexels(count);
}

/** Pixabay Editor's Choice */
async function getRandomPixabay(count) {
  const apiKey = getApiKey();
  const page = Math.floor(Math.random() * 20) + 1;
  const perPage = Math.min(Math.max(count || 1, 3), 20);

  const params = new URLSearchParams({
    key: apiKey,
    editors_choice: 'true',
    image_type: 'photo',
    per_page: String(perPage),
    page: String(page),
    safesearch: 'true',
  });

  const url = `https://pixabay.com/api/?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WhatsApp-Bot/1.0' },
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      return { success: false, error: 'Could not fetch curated images from Pixabay.' };
    }

    const data = await response.json();
    if (!data?.hits?.length) {
      return { success: false, error: 'Could not fetch curated images. Please try again.' };
    }

    const photos = data.hits.slice(0, count).map(normalisePixabayPhoto);
    return { success: true, photos, provider: 'Pixabay' };

  } catch (err) {
    logger.error({ err }, 'Pixabay curated error');
    return { success: false, error: 'Failed to fetch curated images.' };
  }
}

/** Pexels Curated */
async function getRandomPexels(count) {
  try {
    const page = Math.floor(Math.random() * 100) + 1;
    const result = await Promise.race([
      pexelsClient.photos.curated({ per_page: count, page }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 15_000)),
    ]);

    if (!result?.photos?.length) {
      return { success: false, error: 'Could not fetch random images. Please try again.' };
    }

    return { success: true, photos: result.photos.map(normalisePexelsPhoto), provider: 'Pexels' };
  } catch (err) {
    logger.error({ err }, 'Pexels curated error');
    return { success: false, error: classifyImageError(err) };
  }
}

/* ── Download ──────────────────────────────────────────────────────────── */

/**
 * Download an image to a temp file with security and size validation.
 *
 * @param {object} photoSrc - Photo src object from normalised photo
 * @param {string} tempDir  - Temporary directory path
 * @returns {Promise<{ success, filePath?, mimeType?, size?, error? }>}
 */
export async function downloadImage(photoSrc, tempDir) {
  // Prefer high-res variants
  const imageUrl = photoSrc.large2x || photoSrc.large || photoSrc.original || photoSrc.portrait || photoSrc.medium;

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
  ensureReady();
  const provider = getActiveProvider();
  const formattedProvider = provider === 'pixabay' ? 'Pixabay' : 'Pexels';
  return {
    configured: !!getApiKey(),
    provider:   formattedProvider,
    error:      initError,
  };
}

/* ── Normalisation helpers ─────────────────────────────────────────────── */

function normalisePixabayPhoto(hit) {
  return {
    id:              hit.id,
    width:           hit.imageWidth || 1920,
    height:          hit.imageHeight || 1080,
    photographer:    hit.user || 'Pixabay Contributor',
    photographerUrl: hit.user ? `https://pixabay.com/users/${encodeURIComponent(hit.user)}-${hit.user_id}/` : hit.pageURL,
    url:             hit.pageURL,
    provider:        'Pixabay',
    src: {
      original: hit.largeImageURL || hit.webformatURL,
      large2x:  hit.largeImageURL || hit.webformatURL,
      large:    hit.largeImageURL || hit.webformatURL,
      medium:   hit.webformatURL,
      portrait: hit.largeImageURL || hit.webformatURL,
    },
    alt:      hit.tags || '',
    views:    hit.views,
    likes:    hit.likes,
  };
}

function normalisePexelsPhoto(p) {
  return {
    id:              p.id,
    width:           p.width,
    height:          p.height,
    photographer:    p.photographer,
    photographerUrl: p.photographer_url,
    url:             p.url,
    provider:        'Pexels',
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

function classifyImageError(err) {
  const msg = err.message ?? '';
  if (msg.includes('timeout') || msg.includes('Timeout'))       return 'Image search timed out. Please try again.';
  if (msg.includes('401') || msg.includes('Unauthorized'))      return 'Image provider API key is invalid.';
  if (msg.includes('429') || msg.includes('Too Many Requests')) return 'Image search rate limit reached. Please try again later.';
  return 'Failed to search for images. Please try again.';
}
