/**
 * config.js — Centralised, validated configuration loader.
 * All env-sourced values are read, typed, and validated here.
 * No other module should call process.env directly.
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ── helpers ─────────────────────────────────────────────────────────────── */

function required(key) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    throw new Error(
      `[config] Missing required environment variable: ${key}\n` +
      `  → Copy .env.example to .env and fill in all required values.`
    );
  }
  return val.trim();
}

function optional(key, defaultValue = '') {
  return (process.env[key] ?? defaultValue).trim();
}

function parseOwnerNumbers(raw) {
  if (!raw || raw.trim() === '') {
    throw new Error(
      '[config] OWNER_NUMBERS is not set.\n' +
      '  → Add at least one phone number (with country code) to your .env file.\n' +
      '  → Example: OWNER_NUMBERS=94771234567'
    );
  }
  return raw
    .split(',')
    .map(n => n.trim().replace(/\D/g, '')) // strip non-digits
    .filter(Boolean)
    .map(n => `${n}@s.whatsapp.net`);
}

/* ── build config ────────────────────────────────────────────────────────── */

const raw = {
  ownerNumbers:         optional('OWNER_NUMBERS'),
  botName:              optional('BOT_NAME', 'BEN10_Bot'),
  botVersion:           optional('BOT_VERSION', '1.0.0'),
  prefix:               optional('PREFIX', '.'),
  timezone:             optional('TIMEZONE', 'Asia/Colombo'),
  supportLink:          optional('SUPPORT_LINK', ''),
  authDir:              optional('AUTH_DIR', 'auth'),
  dataDir:              optional('DATA_DIR', 'data'),
  logLevel:             optional('LOG_LEVEL', 'info'),
  usePairingCode:       optional('USE_PAIRING_CODE', 'false'),
  pairingPhoneNumber:   optional('PAIRING_PHONE_NUMBER', ''),
  maxReconnectAttempts: optional('MAX_RECONNECT_ATTEMPTS', '10'),
  autoRead:             optional('AUTO_READ', 'false'),
  markOnline:           optional('MARK_ONLINE', 'true'),
  blockedDomains:       optional('BLOCKED_DOMAINS', ''),
  antilinkWarnLimit:    optional('ANTILINK_WARN_LIMIT', '3'),

  /* AI */
  ollamaApiKey:         optional('OLLAMA_API_KEY'),
  ollamaModel:          optional('OLLAMA_MODEL', 'gemma4:31b-cloud'),
  aiEnabled:            optional('AI_ENABLED', 'true'),

  /* Media & Image */
  imageProvider:          optional('IMAGE_PROVIDER'),
  pixabayApiKey:          optional('PIXABAY_API_KEY'),
  pexelsApiKey:           optional('PEXELS_API_KEY'),
  imageProviderApiKey:    optional('PIXABAY_API_KEY') || optional('PEXELS_API_KEY'),
  mediaEnabled:           optional('MEDIA_ENABLED', 'true'),
  maxMediaSizeMb:         optional('MAX_MEDIA_SIZE_MB', '50'),
  maxConcurrentDownloads: optional('MAX_CONCURRENT_DOWNLOADS', '2'),
  tempDir:                optional('TEMP_DIR', 'temp'),
};

// Validate owner numbers
const ownerJids = parseOwnerNumbers(raw.ownerNumbers);

const config = {
  /* Identity */
  botName:    raw.botName || 'BEN10_Bot',
  botVersion: raw.botVersion || '1.0.0',
  prefix:     raw.prefix.length === 0 ? '.' : raw.prefix,
  timezone:   raw.timezone || 'Asia/Colombo',
  supportLink: raw.supportLink,

  /* Owner */
  ownerNumbers: ownerJids,

  /* Paths */
  authDir: path.resolve(ROOT, raw.authDir),
  dataDir: path.resolve(ROOT, raw.dataDir),
  logsDir: path.resolve(ROOT, 'logs'),
  tempDir: path.resolve(ROOT, raw.tempDir || 'temp'),

  /* Logging */
  logLevel: ['trace','debug','info','warn','error','fatal','silent'].includes(raw.logLevel)
    ? raw.logLevel
    : 'info',

  /* Connection */
  usePairingCode:       raw.usePairingCode === 'true',
  pairingPhoneNumber:   raw.pairingPhoneNumber.replace(/\D/g, ''),
  maxReconnectAttempts: Math.max(0, parseInt(raw.maxReconnectAttempts, 10) || 10),

  /* Features */
  autoRead:   raw.autoRead === 'true',
  markOnline: raw.markOnline !== 'false',

  /* Anti-link */
  blockedDomains: raw.blockedDomains
    ? raw.blockedDomains.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
    : [],
  antilinkWarnLimit: Math.max(1, parseInt(raw.antilinkWarnLimit, 10) || 3),

  /* AI */
  ollamaApiKey: raw.ollamaApiKey,
  ollamaModel:  raw.ollamaModel || 'gemma4:31b-cloud',
  aiEnabled:    raw.aiEnabled !== 'false',

  /* Media & Image */
  imageProvider:          raw.imageProvider?.toLowerCase() || (raw.pixabayApiKey ? 'pixabay' : (raw.pexelsApiKey ? 'pexels' : 'pixabay')),
  imageProviderApiKey:    raw.imageProviderApiKey,
  pixabayApiKey:          raw.pixabayApiKey,
  pexelsApiKey:           raw.pexelsApiKey,
  mediaEnabled:           raw.mediaEnabled !== 'false',
  maxMediaSizeMb:         Math.max(1, parseInt(raw.maxMediaSizeMb, 10) || 50),
  maxConcurrentDownloads: Math.max(1, parseInt(raw.maxConcurrentDownloads, 10) || 2),

  /* Derived helpers */
  isOwner(jid) {
    const normalised = jid?.split(':')[0]?.split('@')[0];
    return ownerJids.some(o => o.startsWith(normalised + '@'));
  },
};

export default config;
