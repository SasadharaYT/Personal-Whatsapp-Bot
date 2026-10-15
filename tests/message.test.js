/**
 * tests/message.test.js — Unit tests for message utility functions.
 * 
 * These tests import utilities that depend on permissions.js which in turn
 * imports config.js. env vars are set in jest.setup.js before module load.
 */

import { describe, it, expect } from '@jest/globals';

// The utils/message.js only imports normaliseJid from permissions.js
// and permissions.js imports config.js - env vars set in jest.setup.js ensure this works.
import {
  extractText,
  formatUptime,
  isValidPhone,
  phoneToJid,
  mentionJid,
} from '../src/utils/message.js';

/* ══════════════════════════════════════════════════════════════════════════ */

describe('extractText', () => {
  it('extracts text from conversation', () => {
    expect(extractText({ conversation: 'Hello' })).toBe('Hello');
  });

  it('extracts text from extendedTextMessage', () => {
    expect(extractText({ extendedTextMessage: { text: 'World' } })).toBe('World');
  });

  it('extracts caption from imageMessage', () => {
    expect(extractText({ imageMessage: { caption: 'A photo' } })).toBe('A photo');
  });

  it('extracts caption from videoMessage', () => {
    expect(extractText({ videoMessage: { caption: 'A video' } })).toBe('A video');
  });

  it('returns empty string for null', () => {
    expect(extractText(null)).toBe('');
    expect(extractText(undefined)).toBe('');
  });

  it('returns empty string for message with no text field', () => {
    expect(extractText({ stickerMessage: {} })).toBe('');
  });

  it('prefers conversation over extendedTextMessage', () => {
    expect(extractText({
      conversation: 'primary',
      extendedTextMessage: { text: 'secondary' },
    })).toBe('primary');
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('formatUptime', () => {
  it('formats seconds only', () => {
    expect(formatUptime(45_000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatUptime(125_000)).toBe('2m 5s');
  });

  it('formats hours, minutes, seconds', () => {
    expect(formatUptime(3_661_000)).toBe('1h 1m 1s');
  });

  it('formats days', () => {
    expect(formatUptime(90_000_000)).toBe('1d 1h 0m 0s');
  });

  it('formats 0ms as 0s', () => {
    expect(formatUptime(0)).toBe('0s');
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('isValidPhone', () => {
  it('accepts valid phone numbers', () => {
    expect(isValidPhone('94771234567')).toBe(true);
    expect(isValidPhone('+1-800-555-0100')).toBe(true);
  });

  it('rejects short numbers', () => {
    expect(isValidPhone('123')).toBe(false);
  });

  it('rejects too-long numbers (>15 digits)', () => {
    expect(isValidPhone('1234567890123456')).toBe(false);
  });

  it('accepts 7-digit number (minimum valid)', () => {
    expect(isValidPhone('1234567')).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('phoneToJid', () => {
  it('converts plain phone number to JID', () => {
    expect(phoneToJid('94771234567')).toBe('94771234567@s.whatsapp.net');
  });

  it('strips non-digit characters', () => {
    expect(phoneToJid('+94 77 123 4567')).toBe('94771234567@s.whatsapp.net');
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('mentionJid', () => {
  it('formats a JID as @number mention', () => {
    expect(mentionJid('94771234567@s.whatsapp.net')).toBe('@94771234567');
  });

  it('handles JIDs with device suffix', () => {
    // normaliseJid strips :device suffix
    expect(mentionJid('94771234567:12@s.whatsapp.net')).toBe('@94771234567');
  });
});
