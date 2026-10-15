/**
 * tests/settings.test.js — Unit tests for the settings service.
 *
 * Uses a temporary directory for isolated persistence testing.
 * Env vars are set in jest.setup.js (OWNER_NUMBERS etc).
 * No real WhatsApp connection or credentials required.
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import os   from 'os';
import path from 'path';
import fs   from 'fs/promises';

// Override data dir to a unique tmp location for this test run
const TMP_DIR = path.join(os.tmpdir(), `bot_test_${Date.now()}`);
process.env.DATA_DIR = TMP_DIR;
process.env.LOGS_DIR = TMP_DIR;

// Must set before importing settings which reads config
// (config already read from jest.setup.js env vars)

beforeAll(async () => {
  await fs.mkdir(TMP_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
});

// Import after env overrides
const {
  getGroupSettings,
  patchGroupSettings,
  saveGroupSettings,
  addWarn,
  getWarnings,
  resetWarnings,
  addAntilinkWarning,
  resetAntilinkWarnings,
  getGlobalSettings,
  patchGlobalSettings,
  blockUser,
  unblockUser,
  isBlocked,
} = await import('../src/services/settings.js');

/* ══════════════════════════════════════════════════════════════════════════ */

describe('Group Settings — Defaults', () => {
  const GROUP = '1234567890-defaulttest@g.us';

  it('returns defaults for an unknown group', async () => {
    const gs = await getGroupSettings(GROUP);
    expect(gs.antilink.enabled).toBe(false);
    expect(gs.welcome.enabled).toBe(false);
    expect(gs.goodbye.enabled).toBe(false);
    expect(gs.muted).toBe(false);
    expect(gs.warns).toBeDefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Group Settings — Persistence', () => {
  const GROUP = '9876543210-persist@g.us';

  it('patches and retrieves muted flag', async () => {
    await patchGroupSettings(GROUP, { muted: true });
    const gs = await getGroupSettings(GROUP);
    expect(gs.muted).toBe(true);
  });

  it('merges nested antilink settings without clobbering others', async () => {
    await patchGroupSettings(GROUP, { antilink: { enabled: true } });
    const gs = await getGroupSettings(GROUP);
    expect(gs.antilink.enabled).toBe(true);
    expect(gs.muted).toBe(true);  // should still be set
  });

  it('persists welcome message template', async () => {
    await patchGroupSettings(GROUP, { welcome: { message: 'Hey {user}!' } });
    const gs = await getGroupSettings(GROUP);
    expect(gs.welcome.message).toBe('Hey {user}!');
  });

  it('persists goodbye message template', async () => {
    await patchGroupSettings(GROUP, { goodbye: { message: 'Bye {user}!' } });
    const gs = await getGroupSettings(GROUP);
    expect(gs.goodbye.message).toBe('Bye {user}!');
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Warning System', () => {
  const GROUP = '1111-warns@g.us';
  const USER  = '94771234568@s.whatsapp.net';

  it('adds a warning with reason and returns count 1', async () => {
    const w = await addWarn(GROUP, USER, 'Spamming');
    expect(w.count).toBe(1);
    expect(w.reasons[0]).toBe('Spamming');
  });

  it('accumulates warnings to count 2', async () => {
    await addWarn(GROUP, USER, 'Flooding');
    const w = await getWarnings(GROUP, USER);
    expect(w.count).toBe(2);
    expect(w.reasons).toHaveLength(2);
  });

  it('resets warnings to 0', async () => {
    await resetWarnings(GROUP, USER);
    const w = await getWarnings(GROUP, USER);
    expect(w.count).toBe(0);
    expect(w.reasons).toHaveLength(0);
  });

  it('returns zero count for a user with no warnings', async () => {
    const w = await getWarnings(GROUP, '99999@s.whatsapp.net');
    expect(w.count).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Anti-Link Warning Tracking', () => {
  const GROUP = '2222-antilink@g.us';
  const USER  = '94771234569@s.whatsapp.net';

  it('increments antilink warning count to 1', async () => {
    const count = await addAntilinkWarning(GROUP, USER);
    expect(count).toBe(1);
  });

  it('increments antilink warning count to 2', async () => {
    const count = await addAntilinkWarning(GROUP, USER);
    expect(count).toBe(2);
  });

  it('resets antilink warnings', async () => {
    await resetAntilinkWarnings(GROUP, USER);
    const gs = await getGroupSettings(GROUP);
    expect(gs.antilink.warnings[USER]).toBeUndefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Global Settings', () => {
  it('returns a prefix (default or configured)', async () => {
    const gs = await getGlobalSettings();
    expect(typeof gs.prefix).toBe('string');
    expect(gs.prefix.length).toBeGreaterThan(0);
  });

  it('persists a prefix change', async () => {
    await patchGlobalSettings({ prefix: '!' });
    const gs = await getGlobalSettings();
    expect(gs.prefix).toBe('!');
    // Restore
    await patchGlobalSettings({ prefix: '.' });
  });

  it('persists bot name change', async () => {
    await patchGlobalSettings({ botName: 'ChangeBot' });
    const gs = await getGlobalSettings();
    expect(gs.botName).toBe('ChangeBot');
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Blocked Users', () => {
  const USER = '94000000001@s.whatsapp.net';

  it('starts unblocked', async () => {
    expect(await isBlocked(USER)).toBe(false);
  });

  it('blocks a user', async () => {
    await blockUser(USER);
    expect(await isBlocked(USER)).toBe(true);
  });

  it('does not duplicate block', async () => {
    await blockUser(USER);  // second call
    const gs = await getGlobalSettings();
    const count = gs.blockedUsers.filter(u => u === USER).length;
    expect(count).toBe(1);
  });

  it('unblocks a user', async () => {
    await unblockUser(USER);
    expect(await isBlocked(USER)).toBe(false);
  });
});
