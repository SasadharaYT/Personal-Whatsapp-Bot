/**
 * media-downloader.js — YouTube media downloader via yt-dlp subprocess.
 *
 * Features:
 *  - Controlled subprocess via spawn (no shell, fixed executable path)
 *  - Bounded job queue with concurrent download limit
 *  - Per-user cooldowns and rate limits
 *  - Download timeouts, disk space checks, file validation
 *  - Temp-file cleanup on success, failure, and cancellation
 *  - Progress tracking with throttled updates
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import config from '../config.js';
import logger from './logger.js';
import { mediaLimiter } from './rate-limiter.js';
import {
  isValidYouTubeUrl,
  safeTempPath, cleanupFile, ensureTempDir,
  getAvailableDiskSpace, validateFileSignature,
} from './safety.js';

/* ── Constants ─────────────────────────────────────────────────────────── */

const DOWNLOAD_TIMEOUT_MS = 300_000;   // 5 minutes
const USER_COOLDOWN_MS    = 30_000;    // 30 seconds between downloads
const MIN_DISK_SPACE_MB   = 500;       // Require 500 MB free

/* ── State ─────────────────────────────────────────────────────────────── */

/** @type {Map<string, Job>} */
const activeJobs     = new Map();
/** @type {Map<string, number>} senderJid → timestamp */
const userCooldowns  = new Map();

let ytDlpPath    = null;
let ffmpegPath   = null;
let execsChecked = false;

/* ── Executable discovery ──────────────────────────────────────────────── */

/**
 * Common fallback paths where yt-dlp / ffmpeg may live on Linux
 * (pip, pipx, snap, manual /usr/local installs).
 */
const LINUX_FALLBACK_PATHS = {
  'yt-dlp': [
    '/usr/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/snap/bin/yt-dlp',
    path.join(process.env.HOME || '/root', '.local/bin/yt-dlp'),
  ],
  ffmpeg: [
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/snap/bin/ffmpeg',
  ],
};

/**
 * Find yt-dlp and ffmpeg on the system PATH (or well-known fallback paths).
 * Called lazily; results are cached.
 *
 * On Linux we use `command -v` via shell instead of `which`, because `which`
 * is not installed on minimal Ubuntu/Debian images, whereas `command -v` is a
 * POSIX shell built-in guaranteed to exist.
 */
async function findExecutables() {
  if (execsChecked) return;
  execsChecked = true;

  const isWin = process.platform === 'win32';

  ytDlpPath  = await locateExecutable('yt-dlp',  isWin);
  ffmpegPath = await locateExecutable('ffmpeg', isWin);
}

/**
 * Locate a single executable by name.
 *
 * Strategy (in order):
 *  1. PATH lookup  (`where.exe` on Windows, `command -v` via shell on Linux)
 *  2. Fallback path probing (Linux only — pip, pipx, snap, /usr/local)
 *  3. Quick `--version` validation to confirm the binary actually runs
 *
 * @param {string} name   - Executable base name (e.g. 'yt-dlp')
 * @param {boolean} isWin - true on Windows
 * @returns {Promise<string|null>} Resolved absolute path, or null.
 */
async function locateExecutable(name, isWin) {
  const candidates = isWin ? [name, `${name}.exe`] : [name];

  /* ── 1. PATH lookup ──────────────────────────────────────────────────── */
  for (const candidate of candidates) {
    try {
      const r = isWin
        ? await runSimple('where.exe', [candidate], 5000)
        : await runSimple('sh', ['-c', `command -v ${candidate}`], 5000, true);

      if (r.code === 0 && r.stdout.trim()) {
        const found = r.stdout.trim().split(/\r?\n/)[0].trim();
        if (await verifyExecutable(found, name)) {
          logger.info({ path: found }, `Found ${name}`);
          return found;
        }
      }
    } catch { /* continue to next candidate */ }
  }

  /* ── 2. Fallback paths (Linux only) ──────────────────────────────────── */
  if (!isWin && LINUX_FALLBACK_PATHS[name]) {
    for (const fallback of LINUX_FALLBACK_PATHS[name]) {
      try {
        await fs.access(fallback, fs.constants?.X_OK ?? 1 /* fs.constants.X_OK */);
        if (await verifyExecutable(fallback, name)) {
          logger.info({ path: fallback }, `Found ${name} at fallback path`);
          return fallback;
        }
      } catch { /* not here, try next */ }
    }
  }

  logger.warn(`${name} not found on PATH or fallback locations`);
  return null;
}

/**
 * Quick smoke-test: run executable version command and check exit code 0.
 * ffmpeg uses single dash `-version`; yt-dlp uses double dash `--version`.
 * Catches cases where the file exists but is not actually executable
 * (e.g. broken symlink, wrong architecture).
 */
async function verifyExecutable(execPath, name = '') {
  try {
    const primaryArg = name === 'ffmpeg' ? '-version' : '--version';
    let r = await runSimple(execPath, [primaryArg], 5000);
    if (r.code === 0) return true;

    // Fallback in case executable supports the alternative flag
    const altArg = name === 'ffmpeg' ? '--version' : '-version';
    r = await runSimple(execPath, [altArg], 5000);
    return r.code === 0;
  } catch {
    return false;
  }
}

/**
 * Get merged process environment ensuring standard bin directories are included in PATH.
 * This is crucial on Linux when the bot runs as a systemd service or minimal container,
 * ensuring yt-dlp can locate deno (/usr/local/bin), ffmpeg, and ffprobe.
 */
function getProcessEnv() {
  if (process.platform === 'win32') return process.env;
  const extraPaths = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/snap/bin',
    path.join(process.env.HOME || '/root', '.local/bin'),
  ];
  const currentPath = process.env.PATH || '';
  const mergedPath = [...new Set([...currentPath.split(':'), ...extraPaths])].filter(Boolean).join(':');
  return { ...process.env, PATH: mergedPath };
}

/**
 * Run a simple command and collect output.
 *
 * @param {string}   cmd       - Command / path to execute
 * @param {string[]} args      - Arguments
 * @param {number}   timeoutMs - Max wait (default 10 s)
 * @param {boolean}  useShell  - If true, spawn via system shell (needed for
 *                               shell built-ins like `command -v` on Linux)
 */
function runSimple(cmd, args, timeoutMs = 10_000, useShell = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: getProcessEnv(),
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('Timed out')); }, timeoutMs);
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    proc.on('error', err  => { clearTimeout(timer); reject(err); });
  });
}

/* ── Video info ────────────────────────────────────────────────────────── */

/**
 * Retrieve video metadata via yt-dlp --dump-json.
 */
export async function getVideoInfo(url) {
  if (!isValidYouTubeUrl(url)) return { success: false, error: 'Invalid YouTube URL. Only youtube.com and youtu.be links are supported.' };
  await findExecutables();
  if (!ytDlpPath) return { success: false, error: missingYtDlpMessage() };

  try {
    const r = await runSimple(ytDlpPath, [
      '--dump-json', '--no-download', '--no-playlist', '--no-warnings', url,
    ], 30_000);

    if (r.code !== 0) {
      logger.warn({ code: r.code, stderr: r.stderr, url }, 'yt-dlp info failed');
      return { success: false, error: classifyYtDlpError(r.stderr) };
    }

    const info = JSON.parse(r.stdout);

    return {
      success: true,
      info: {
        title:       info.title || 'Unknown',
        duration:    info.duration || 0,
        durationStr: fmtDuration(info.duration || 0),
        channel:     info.channel || info.uploader || 'Unknown',
        viewCount:   info.view_count,
        uploadDate:  info.upload_date,
        thumbnail:   info.thumbnail,
        description: (info.description || '').slice(0, 200),
        isLive:      info.is_live || false,
        ageLimit:    info.age_limit || 0,
      },
    };

  } catch (err) {
    logger.error({ err, url }, 'yt-dlp info error');
    if (err.message?.includes('Timed out')) return { success: false, error: 'Video info request timed out.' };
    return { success: false, error: 'Failed to fetch video information.' };
  }
}

/* ── Download ──────────────────────────────────────────────────────────── */

/**
 * Download a YouTube video or audio track.
 *
 * @param {string}   url        - YouTube URL
 * @param {'video'|'audio'} type
 * @param {string}   senderJid  - For rate limiting and tracking
 * @param {function} [onProgress] - Throttled progress callback(percentStr, job)
 * @returns {Promise<{ success, filePath?, size?, type?, jobId?, error? }>}
 */
export async function download(url, type, senderJid, onProgress) {
  if (!isValidYouTubeUrl(url)) return { success: false, error: 'Invalid YouTube URL. Only youtube.com and youtu.be links are supported.' };
  await findExecutables();

  if (!ytDlpPath)        return { success: false, error: missingYtDlpMessage() };
  if (!config.mediaEnabled) return { success: false, error: 'Media downloads are currently disabled.' };

  // ── Rate limit ────────────────────────────────────────────────────────
  const rl = mediaLimiter.check(senderJid);
  if (!rl.allowed) {
    return { success: false, error: `⏳ Rate limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.` };
  }

  // ── User cooldown ─────────────────────────────────────────────────────
  const lastDl = userCooldowns.get(senderJid);
  if (lastDl && Date.now() - lastDl < USER_COOLDOWN_MS) {
    const wait = Math.ceil((USER_COOLDOWN_MS - (Date.now() - lastDl)) / 1000);
    return { success: false, error: `⏳ Please wait ${wait}s before starting another download.` };
  }

  // ── Concurrent limits ─────────────────────────────────────────────────
  let userActive = 0;
  for (const j of activeJobs.values()) {
    if (j.senderJid === senderJid && j.status === 'downloading') userActive++;
  }
  if (userActive >= 1) return { success: false, error: 'You already have a download in progress. Please wait for it to finish.' };

  const totalActive = [...activeJobs.values()].filter(j => j.status === 'downloading').length;
  const maxConcurrent = config.maxConcurrentDownloads || 2;
  if (totalActive >= maxConcurrent) return { success: false, error: `Download queue is full (${maxConcurrent} active). Please try again later.` };

  // ── Disk space ────────────────────────────────────────────────────────
  const tempDir = config.tempDir;
  await ensureTempDir(tempDir);
  const freeSpace = await getAvailableDiskSpace(tempDir);
  if (typeof freeSpace === 'bigint' ? freeSpace < BigInt(MIN_DISK_SPACE_MB) * 1024n * 1024n : freeSpace < MIN_DISK_SPACE_MB * 1024 * 1024) {
    return { success: false, error: 'Insufficient disk space for download.' };
  }

  // ── Prepare ───────────────────────────────────────────────────────────
  const ext        = type === 'audio' ? '.mp3' : '.mp4';
  const outputPath = safeTempPath('ytdl', ext, tempDir);
  const jobId      = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const maxSizeMb  = config.maxMediaSizeMb || 50;

  const args = ['--no-playlist', '--no-warnings', '--no-check-certificates', '--no-call-home', '--geo-bypass',
    '--max-filesize', `${maxSizeMb}m`, '-o', outputPath];

  if (type === 'audio') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '128K');
    if (ffmpegPath) args.push('--ffmpeg-location', path.dirname(ffmpegPath));
  } else {
    args.push('-f', `bestvideo[filesize<=${maxSizeMb}M][ext=mp4]+bestaudio[ext=m4a]/best[filesize<=${maxSizeMb}M][ext=mp4]/best[filesize<=${maxSizeMb}M]`,
      '--merge-output-format', 'mp4');
    if (ffmpegPath) args.push('--ffmpeg-location', path.dirname(ffmpegPath));
  }
  args.push(url);

  /** @type {Job} */
  const job = { id: jobId, senderJid, type, url, startTime: Date.now(), filePath: outputPath, status: 'downloading', progress: '0%', process: null, error: null };
  activeJobs.set(jobId, job);
  userCooldowns.set(senderJid, Date.now());

  // ── Spawn ─────────────────────────────────────────────────────────────
  return new Promise(resolve => {
    const proc = spawn(ytDlpPath, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: getProcessEnv(),
    });
    job.process = proc;

    const timer = setTimeout(() => { job.status = 'timeout'; proc.kill('SIGTERM'); setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000); }, DOWNLOAD_TIMEOUT_MS);
    let lastUpdate = 0;

    const parseProgress = chunk => {
      const m = chunk.toString().match(/(\d+\.?\d*)%/);
      if (m) {
        job.progress = m[1] + '%';
        const now = Date.now();
        if (onProgress && now - lastUpdate > 5000) { lastUpdate = now; onProgress(job.progress, job); }
      }
    };

    proc.stdout.on('data', parseProgress);
    proc.stderr.on('data', d => { job.error = d.toString().slice(-500); parseProgress(d); });

    proc.on('close', async code => {
      clearTimeout(timer);
      if (job.status === 'cancelled' || job.status === 'timeout') {
        await cleanupDownload(outputPath);
        activeJobs.delete(jobId);
        resolve({ success: false, error: job.status === 'cancelled' ? 'Download was cancelled.' : 'Download timed out (5 min limit).' });
        return;
      }
      if (code !== 0) {
        await cleanupDownload(outputPath);
        activeJobs.delete(jobId);
        resolve({ success: false, error: classifyYtDlpError(job.error || '') });
        return;
      }

      // ── Find and validate output file ──────────────────────────────
      const actualPath = await findOutputFile(outputPath, ext);
      if (!actualPath) { activeJobs.delete(jobId); resolve({ success: false, error: 'Download completed but output file not found.' }); return; }

      try {
        const stat = await fs.stat(actualPath);
        const maxBytes = maxSizeMb * 1024 * 1024;
        if (stat.size === 0) { await cleanupFile(actualPath); activeJobs.delete(jobId); resolve({ success: false, error: 'Downloaded file is empty.' }); return; }
        if (stat.size > maxBytes) { await cleanupFile(actualPath); activeJobs.delete(jobId); resolve({ success: false, error: `File too large (${Math.round(stat.size / 1024 / 1024)}MB). WhatsApp limit: ~${maxSizeMb}MB.` }); return; }

        // Validate header bytes (warn only — yt-dlp output is trusted)
        const header = Buffer.alloc(12);
        const fh = await fs.open(actualPath, 'r');
        try { await fh.read(header, 0, 12, 0); } finally { await fh.close(); }
        const expected = type === 'audio' ? ['audio/mpeg', 'audio/mp4', 'audio/ogg'] : ['video/mp4'];
        const sig = validateFileSignature(header, expected);
        if (!sig.valid && sig.detectedType) logger.warn({ detectedType: sig.detectedType, expected }, 'Unexpected file type from yt-dlp');

        job.status = 'completed';
        job.filePath = actualPath;
        activeJobs.delete(jobId);
        resolve({ success: true, filePath: actualPath, size: stat.size, type, jobId });

      } catch (err) {
        await cleanupFile(actualPath);
        activeJobs.delete(jobId);
        logger.error({ err }, 'File validation error');
        resolve({ success: false, error: 'Downloaded file validation failed.' });
      }
    });

    proc.on('error', async err => {
      clearTimeout(timer);
      await cleanupDownload(outputPath);
      activeJobs.delete(jobId);
      logger.error({ err }, 'yt-dlp process error');
      resolve({ success: false, error: 'Download process failed to start. Is yt-dlp installed?' });
    });
  });
}

/* ── Job management ────────────────────────────────────────────────────── */

/**
 * Cancel a running download job.
 */
export function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return { success: false, error: 'Job not found.' };
  if (job.status !== 'downloading') return { success: false, error: `Job is already ${job.status}.` };

  job.status = 'cancelled';
  if (job.process) {
    job.process.kill('SIGTERM');
    setTimeout(() => { try { job.process.kill('SIGKILL'); } catch {} }, 5000);
  }
  return { success: true, message: `Download ${jobId} cancelled.` };
}

/** Return info on active jobs (safe for display). */
export function getActiveJobs() {
  return [...activeJobs.values()].map(j => ({
    id: j.id, sender: j.senderJid, type: j.type, status: j.status,
    progress: j.progress, elapsed: Math.round((Date.now() - j.startTime) / 1000) + 's',
  }));
}

/** Return downloader status. */
export async function getDownloaderStatus() {
  await findExecutables();
  return {
    ytDlpInstalled: !!ytDlpPath, ytDlpPath,
    ffmpegInstalled: !!ffmpegPath, ffmpegPath,
    activeJobs: activeJobs.size, maxConcurrent: config.maxConcurrentDownloads || 2,
  };
}

/** Clean up all active downloads (called on shutdown). */
export async function cleanupAll() {
  for (const [id, job] of activeJobs) {
    if (job.process) { try { job.process.kill('SIGTERM'); } catch {} }
    await cleanupDownload(job.filePath);
    activeJobs.delete(id);
  }
}

/* ── Internal helpers ──────────────────────────────────────────────────── */

async function cleanupDownload(outputPath) {
  await cleanupFile(outputPath);
  await cleanupFile(outputPath + '.part');
  await cleanupFile(outputPath + '.ytdl');
}

async function findOutputFile(expectedPath, ext) {
  try { await fs.access(expectedPath); return expectedPath; } catch {}
  // yt-dlp may choose a different extension
  try {
    const dir  = path.dirname(expectedPath);
    const base = path.basename(expectedPath, ext);
    const files = await fs.readdir(dir);
    const match = files.find(f => f.startsWith(base) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
    return match ? path.join(dir, match) : null;
  } catch { return null; }
}

function classifyYtDlpError(stderr = '') {
  if (!stderr) return 'Download failed. The video may be unavailable or restricted.';
  if (stderr.includes('Video unavailable') || stderr.includes('Private video')) return 'This video is unavailable or private.';
  if (stderr.includes('Sign in to confirm your age'))       return 'This video requires age verification and cannot be accessed.';
  if (stderr.includes('File is larger than max-filesize'))  return `Video exceeds the ${config.maxMediaSizeMb || 50}MB size limit. Try a shorter video.`;
  if (stderr.includes('HTTP Error 429'))                    return 'YouTube rate limit reached. Please try again later.';
  if (stderr.includes('copyright'))                         return 'This video is restricted due to copyright.';
  if (stderr.includes('members-only'))                      return 'This video is for channel members only.';
  if (stderr.includes('premium'))                           return 'This video requires YouTube Premium.';
  if (stderr.includes('confirm you’re not a bot') || stderr.includes('confirm you\'re not a bot')) {
    return 'YouTube bot protection triggered on this server IP. Update yt-dlp or try again later.';
  }

  // Extract clean error message from yt-dlp if present
  const errorLine = stderr.split(/\r?\n/).find(l => l.trim().startsWith('ERROR:'));
  if (errorLine) {
    const clean = errorLine.replace(/^ERROR:\s*/, '').replace(/\[[^\]]+\]\s*/, '').trim();
    if (clean.length > 0 && clean.length < 120) return clean;
  }

  return 'Download failed. The video may be unavailable or restricted.';
}

function missingYtDlpMessage() {
  if (process.platform === 'linux') {
    return 'yt-dlp was not found on PATH. On Ubuntu, install it with: sudo apt update && sudo apt install -y yt-dlp ffmpeg';
  }
  if (process.platform === 'win32') {
    return 'yt-dlp was not found on PATH. Install yt-dlp and ffmpeg using the Windows setup instructions in the README.';
  }
  return 'yt-dlp was not found on PATH. Install yt-dlp and ffmpeg using the setup instructions in the README.';
}

function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return 'Unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
