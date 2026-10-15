/**
 * tests/antilink.test.js — Unit tests for anti-link detection.
 *
 * Tests link detection logic in isolation without network/socket calls.
 */

import { describe, it, expect, jest } from '@jest/globals';

/* ── Inline the detection logic for isolated testing ───────────────────── */

const WA_INVITE_RE = /chat\.whatsapp\.com\/[A-Za-z0-9+/]{10,}/g;

function buildExternalRe(domains) {
  if (!domains.length) return null;
  const escaped = domains.map(d => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?:https?://)?(?:www\\.)?(?:${escaped.join('|')})`, 'gi');
}

function containsLink(text, allowlist = [], blockedDomains = []) {
  if (!text) return false;

  WA_INVITE_RE.lastIndex = 0;
  if (WA_INVITE_RE.test(text)) {
    WA_INVITE_RE.lastIndex = 0;
    return true;
  }
  WA_INVITE_RE.lastIndex = 0;

  const extRe = buildExternalRe(blockedDomains);
  if (extRe && extRe.test(text)) return true;

  return false;
}

function isAllowed(text, allowlist) {
  if (!allowlist?.length) return false;
  return allowlist.some(d => text.toLowerCase().includes(d.toLowerCase()));
}

/* ══════════════════════════════════════════════════════════════════════════ */

describe('Anti-Link: WhatsApp Invite Detection', () => {
  it('detects standard WA invite links', () => {
    expect(containsLink('Join here: https://chat.whatsapp.com/AbCdEfGhIjKlMnO')).toBe(true);
  });

  it('detects WA invite without https://', () => {
    expect(containsLink('chat.whatsapp.com/AbCdEfGhIjK1234')).toBe(true);
  });

  it('does not flag regular text', () => {
    expect(containsLink('Hello everyone, welcome to the group!')).toBe(false);
  });

  it('does not flag short WA paths (< 10 chars after /)', () => {
    expect(containsLink('chat.whatsapp.com/short')).toBe(false);
  });

  it('handles empty string', () => {
    expect(containsLink('')).toBe(false);
  });

  it('handles null/undefined gracefully', () => {
    expect(containsLink(null)).toBe(false);
    expect(containsLink(undefined)).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Anti-Link: External Domain Blocking', () => {
  const domains = ['example.com', 'spam.net'];

  it('blocks a configured external domain', () => {
    expect(containsLink('Visit https://example.com/promo', [], domains)).toBe(true);
  });

  it('blocks domain without https://', () => {
    expect(containsLink('Check spam.net for deals', [], domains)).toBe(true);
  });

  it('does not block non-listed domains', () => {
    expect(containsLink('https://google.com is safe', [], domains)).toBe(false);
  });

  it('is case-insensitive for domains', () => {
    expect(containsLink('Visit EXAMPLE.COM today', [], domains)).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Anti-Link: Allowlist', () => {
  const allowlist    = ['safe.example.com'];
  const blockedDomains = ['example.com'];

  it('allows listed domains even if domain pattern matches', () => {
    const text = 'Visit safe.example.com for info';
    expect(isAllowed(text, allowlist)).toBe(true);
  });

  it('does not allow unlisted domains', () => {
    const text = 'Visit evil.example.com for info';
    expect(isAllowed(text, allowlist)).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Anti-Link: Message Utility', () => {
  it('detects link in image caption context', () => {
    // Simulate text extracted from an image caption
    const caption = 'Check this out: https://chat.whatsapp.com/XyZ1234567890';
    expect(containsLink(caption)).toBe(true);
  });
});
