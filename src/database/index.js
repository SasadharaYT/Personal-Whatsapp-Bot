/**
 * database/index.js — Atomic JSON-based persistent store.
 *
 * Uses a write-queue + tmp-file rename to prevent corruption.
 * All reads and writes are async-safe.
 */

import fs from 'fs/promises';
import path from 'path';
import config from '../config.js';

const DATA_DIR = config.dataDir;

// In-memory cache per file key
const cache = new Map();
// Write queue per file to prevent concurrent writes
const writeQueue = new Map();

/** Resolve a safe absolute path under DATA_DIR (prevent path traversal). */
function safePath(key) {
  const name = key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
  const resolved = path.resolve(DATA_DIR, name);
  if (!resolved.startsWith(DATA_DIR)) {
    throw new Error(`[db] Path traversal attempt blocked: ${key}`);
  }
  return resolved;
}

/** Ensure DATA_DIR exists. */
async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Read a JSON store by key.
 * Returns the parsed object, or `defaultValue` if the file does not exist.
 */
export async function read(key, defaultValue = {}) {
  if (cache.has(key)) return cache.get(key);
  await ensureDir();
  const file = safePath(key);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    cache.set(key, data);
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') {
      cache.set(key, defaultValue);
      return defaultValue;
    }
    throw err;
  }
}

/**
 * Atomically write `data` to the JSON store at `key`.
 * Writes to a temp file first, then renames to avoid partial writes.
 */
export async function write(key, data) {
  cache.set(key, data);

  // Serialise writes to the same key
  const prev = writeQueue.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    await ensureDir();
    const file = safePath(key);
    const tmp  = file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, file);
  });
  writeQueue.set(key, next.catch(() => {})); // swallow to unblock queue
  return next;
}

/**
 * Merge `patch` into an existing store at `key`.
 */
export async function merge(key, patch, defaultValue = {}) {
  const current = await read(key, defaultValue);
  const updated  = { ...current, ...patch };
  await write(key, updated);
  return updated;
}

/**
 * Invalidate the in-memory cache for a given key (force re-read).
 */
export function invalidate(key) {
  cache.delete(key);
}

/**
 * Delete a store file.
 */
export async function remove(key) {
  cache.delete(key);
  const file = safePath(key);
  try { await fs.unlink(file); } catch { /* ignore ENOENT */ }
}

/* ── Convenience helpers for namespaced sub-keys ───────────────────────── */

export function makeStore(namespace) {
  return {
    read:  (k, d) => read(`${namespace}_${k}`, d),
    write: (k, v) => write(`${namespace}_${k}`, v),
    merge: (k, p, d) => merge(`${namespace}_${k}`, p, d),
    invalidate: k  => invalidate(`${namespace}_${k}`),
    remove: k      => remove(`${namespace}_${k}`),
  };
}
