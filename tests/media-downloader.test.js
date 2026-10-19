/**
 * tests/media-downloader.test.js — Unit tests for the media downloader service.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../src/services/logger.js', () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
  },
}));

import {
  getVideoInfo,
  download,
  cancelJob,
  getActiveJobs,
  getDownloaderStatus,
} from '../src/services/media-downloader.js';

describe('Media Downloader Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects invalid or non-YouTube URLs immediately', async () => {
    const res = await getVideoInfo('https://evil.com/video.mp4');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid YouTube URL');

    const dlRes = await download('https://notyoutube.com', 'video', 'user1@s.whatsapp.net');
    expect(dlRes.success).toBe(false);
    expect(dlRes.error).toContain('Invalid YouTube URL');
  });

  it('rejects empty or malformed URLs', async () => {
    const res = await getVideoInfo('');
    expect(res.success).toBe(false);
  });

  it('reports downloader status with boolean flags', async () => {
    const status = await getDownloaderStatus();
    expect(status).toHaveProperty('ytDlpInstalled');
    expect(status).toHaveProperty('ffmpegInstalled');
    expect(status).toHaveProperty('activeJobs');
    expect(typeof status.ytDlpInstalled).toBe('boolean');
  });

  it('cancelJob returns error for non-existent job', () => {
    const res = cancelJob('nonexistent_job_123');
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });

  it('getActiveJobs returns an array', () => {
    const jobs = getActiveJobs();
    expect(Array.isArray(jobs)).toBe(true);
  });
});
