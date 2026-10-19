/**
 * tests/safety.test.js — Unit tests for the safety and validation module.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  isValidYouTubeUrl,
  extractYouTubeVideoId,
  isPrivateOrReserved,
  isSafeUrl,
  sanitizeInput,
  truncateText,
  validateFileSignature,
  safeTempPath,
  cleanupFile,
  ensureTempDir,
  getAvailableDiskSpace,
  INPUT_LIMITS,
} from '../src/services/safety.js';

describe('Safety Service', () => {
  let testTempDir;

  beforeEach(async () => {
    testTempDir = path.join(os.tmpdir(), `bot_test_safety_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    await ensureTempDir(testTempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testTempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('YouTube URL validation', () => {
    it('accepts standard YouTube watch URLs', () => {
      expect(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isValidYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    });

    it('accepts youtu.be short URLs', () => {
      expect(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    });

    it('accepts YouTube Shorts URLs', () => {
      expect(isValidYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
    });

    it('accepts Music YouTube URLs', () => {
      expect(isValidYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    });

    it('rejects non-YouTube domains', () => {
      expect(isValidYouTubeUrl('https://evil.com/watch?v=dQw4w9WgXcQ')).toBe(false);
      expect(isValidYouTubeUrl('https://notyoutube.com')).toBe(false);
      expect(isValidYouTubeUrl('https://vimeo.com/123456')).toBe(false);
    });

    it('rejects file and javascript schemes', () => {
      expect(isValidYouTubeUrl('file:///etc/passwd')).toBe(false);
      expect(isValidYouTubeUrl('javascript:alert(1)')).toBe(false);
    });

    it('rejects malformed inputs and empty strings', () => {
      expect(isValidYouTubeUrl('')).toBe(false);
      expect(isValidYouTubeUrl(null)).toBe(false);
      expect(isValidYouTubeUrl(12345)).toBe(false);
      expect(isValidYouTubeUrl('not a url')).toBe(false);
    });

    it('extracts video ID correctly', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeVideoId('https://evil.com/watch?v=dQw4w9WgXcQ')).toBe(null);
    });
  });

  describe('SSRF Prevention', () => {
    it('detects localhost and loopback addresses', () => {
      expect(isPrivateOrReserved('localhost')).toBe(true);
      expect(isPrivateOrReserved('127.0.0.1')).toBe(true);
      expect(isPrivateOrReserved('127.1.2.3')).toBe(true);
      expect(isPrivateOrReserved('::1')).toBe(true);
    });

    it('detects RFC 1918 private IP ranges', () => {
      expect(isPrivateOrReserved('10.0.0.1')).toBe(true);
      expect(isPrivateOrReserved('172.16.0.1')).toBe(true);
      expect(isPrivateOrReserved('172.31.255.255')).toBe(true);
      expect(isPrivateOrReserved('192.168.1.1')).toBe(true);
      expect(isPrivateOrReserved('169.254.169.254')).toBe(true); // AWS metadata
    });

    it('allows public domain names', () => {
      expect(isPrivateOrReserved('images.pexels.com')).toBe(false);
      expect(isPrivateOrReserved('google.com')).toBe(false);
      expect(isPrivateOrReserved('8.8.8.8')).toBe(false);
    });

    it('isSafeUrl blocks URLs with private hosts or credentials', () => {
      expect(isSafeUrl('http://127.0.0.1:8080/secret')).toBe(false);
      expect(isSafeUrl('http://user:pass@example.com/')).toBe(false);
      expect(isSafeUrl('ftp://example.com/file')).toBe(false);
      expect(isSafeUrl('https://images.pexels.com/photos/123/image.jpeg')).toBe(true);
    });
  });

  describe('Input Sanitisation & Truncation', () => {
    it('trims and bounds input text', () => {
      expect(sanitizeInput('   hello world   ')).toBe('hello world');
      expect(sanitizeInput(null)).toBe('');
      expect(sanitizeInput(undefined)).toBe('');

      const longText = 'a'.repeat(5000);
      expect(sanitizeInput(longText, 100).length).toBe(100);
    });

    it('truncates text with ellipsis', () => {
      expect(truncateText('short', 10)).toBe('short');
      expect(truncateText('hello world this is long', 10)).toBe('hello w...');
    });
  });

  describe('File validation', () => {
    it('identifies valid JPEG magic bytes', () => {
      const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
      const res = validateFileSignature(jpegBuffer, ['image/jpeg']);
      expect(res.valid).toBe(true);
      expect(res.detectedType).toBe('image/jpeg');
    });

    it('identifies valid PNG magic bytes', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
      const res = validateFileSignature(pngBuffer, ['image/png']);
      expect(res.valid).toBe(true);
      expect(res.detectedType).toBe('image/png');
    });

    it('rejects invalid or unknown magic bytes', () => {
      const textBuffer = Buffer.from('Just plain text file content');
      const res = validateFileSignature(textBuffer, ['image/jpeg', 'image/png']);
      expect(res.valid).toBe(false);
    });

    it('rejects buffer shorter than 4 bytes', () => {
      const res = validateFileSignature(Buffer.from([0xFF, 0xD8]));
      expect(res.valid).toBe(false);
    });
  });

  describe('Temp file utilities', () => {
    it('generates random safe temp paths within specified directory', () => {
      const p = safeTempPath('test', '.jpg', testTempDir);
      expect(p.startsWith(testTempDir)).toBe(true);
      expect(p.endsWith('.jpg')).toBe(true);
    });

    it('cleans up existing file and handles non-existent file cleanly', async () => {
      const p = path.join(testTempDir, 'temp_to_delete.txt');
      await fs.writeFile(p, 'sample data');
      await cleanupFile(p);

      await expect(fs.access(p)).rejects.toThrow();

      // Silent on ENOENT
      await expect(cleanupFile(p)).resolves.not.toThrow();
    });

    it('gets available disk space without throwing', async () => {
      const space = await getAvailableDiskSpace(testTempDir);
      expect(typeof space === 'bigint' || typeof space === 'number').toBe(true);
    });
  });
});
