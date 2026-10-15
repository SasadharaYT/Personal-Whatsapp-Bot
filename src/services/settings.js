/**
 * settings.js — Per-group and global settings service.
 *
 * Wraps the database layer with typed accessors for:
 *  - Group settings (antilink, welcome, goodbye, mute, warnings)
 *  - Global bot settings (prefix, botName, blocked users)
 */

import { read, write, merge, makeStore } from '../database/index.js';
import config from '../config.js';

const groupStore  = makeStore('group');
const globalStore = makeStore('global');

/* ── Default templates ─────────────────────────────────────────────────── */

const DEFAULT_GROUP = {
  antilink: {
    enabled:     false,
    allowlist:   [],
    warnLimit:   config.antilinkWarnLimit,
    warnings:    {},
  },
  welcome: {
    enabled:  false,
    message:  'Welcome {user} to {group}! 👋',
  },
  goodbye: {
    enabled:  false,
    message:  'Goodbye {user}! 👋',
  },
  muted:    false,      // ordinary members cannot use bot commands
  warns:    {},         // { jid: { count, reasons: [] } }
};

const DEFAULT_GLOBAL = {
  prefix:       config.prefix,
  botName:      config.botName,
  blockedUsers: [],
};

/* ── Group settings ─────────────────────────────────────────────────────── */

/** Sanitise group id key (strip non-safe chars). */
function gKey(groupJid) {
  return groupJid.replace(/[^a-zA-Z0-9]/g, '_');
}

export async function getGroupSettings(groupJid) {
  const data = await groupStore.read(gKey(groupJid), null);
  if (!data) return structuredClone(DEFAULT_GROUP);
  // Deep-merge defaults so new fields are always present
  return deepMergeDefaults(DEFAULT_GROUP, data);
}

export async function saveGroupSettings(groupJid, settings) {
  await groupStore.write(gKey(groupJid), settings);
}

export async function patchGroupSettings(groupJid, patch) {
  const current = await getGroupSettings(groupJid);
  const updated  = deepMerge(current, patch);
  await saveGroupSettings(groupJid, updated);
  return updated;
}

/* ── Global settings ───────────────────────────────────────────────────── */

export async function getGlobalSettings() {
  const data = await globalStore.read('settings', null);
  return deepMergeDefaults(DEFAULT_GLOBAL, data ?? {});
}

export async function patchGlobalSettings(patch) {
  const current = await getGlobalSettings();
  const updated  = deepMerge(current, patch);
  await globalStore.write('settings', updated);
  return updated;
}

/* ── Blocked users ─────────────────────────────────────────────────────── */

export async function getBlockedUsers() {
  const gs = await getGlobalSettings();
  return gs.blockedUsers ?? [];
}

export async function blockUser(jid) {
  const gs = await getGlobalSettings();
  if (!gs.blockedUsers.includes(jid)) {
    gs.blockedUsers.push(jid);
    await patchGlobalSettings({ blockedUsers: gs.blockedUsers });
  }
}

export async function unblockUser(jid) {
  const gs = await getGlobalSettings();
  gs.blockedUsers = gs.blockedUsers.filter(u => u !== jid);
  await patchGlobalSettings({ blockedUsers: gs.blockedUsers });
}

export async function isBlocked(jid) {
  const list = await getBlockedUsers();
  return list.includes(jid);
}

/* ── Warn system ───────────────────────────────────────────────────────── */

export async function addWarn(groupJid, userJid, reason = '') {
  const gs = await getGroupSettings(groupJid);
  if (!gs.warns[userJid]) gs.warns[userJid] = { count: 0, reasons: [] };
  gs.warns[userJid].count++;
  gs.warns[userJid].reasons.push(reason);
  await saveGroupSettings(groupJid, gs);
  return gs.warns[userJid];
}

export async function getWarnings(groupJid, userJid) {
  const gs = await getGroupSettings(groupJid);
  return gs.warns[userJid] ?? { count: 0, reasons: [] };
}

export async function resetWarnings(groupJid, userJid) {
  const gs = await getGroupSettings(groupJid);
  delete gs.warns[userJid];
  await saveGroupSettings(groupJid, gs);
}

/* ── Anti-link warnings ─────────────────────────────────────────────────── */

export async function addAntilinkWarning(groupJid, userJid) {
  const gs = await getGroupSettings(groupJid);
  if (!gs.antilink.warnings[userJid]) gs.antilink.warnings[userJid] = 0;
  gs.antilink.warnings[userJid]++;
  await saveGroupSettings(groupJid, gs);
  return gs.antilink.warnings[userJid];
}

export async function resetAntilinkWarnings(groupJid, userJid) {
  const gs = await getGroupSettings(groupJid);
  delete gs.antilink.warnings[userJid];
  await saveGroupSettings(groupJid, gs);
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function deepMergeDefaults(defaults, data) {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && v !== null) {
      if (typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object') {
        out[k] = deepMergeDefaults(out[k], v);
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}
