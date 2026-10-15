/**
 * tests/handler.test.js — Unit tests for the command handler.
 *
 * Uses mocked sockets and message objects. No real WhatsApp connection.
 */

import { describe, it, expect, beforeAll, afterEach, jest } from '@jest/globals';

// ── Mock config before importing modules that use it ──────────────────────
jest.mock('../src/config.js', () => ({
  default: {
    botName:      'TestBot',
    botVersion:   '1.0.0',
    prefix:       '.',
    timezone:     'Asia/Colombo',
    ownerNumbers: ['94771234567@s.whatsapp.net'],
    authDir:      '/tmp/auth',
    dataDir:      '/tmp/data',
    logsDir:      '/tmp/logs',
    logLevel:     'silent',
    autoRead:     false,
    markOnline:   false,
    antilinkWarnLimit: 3,
    blockedDomains: [],
    isOwner: (jid) => jid === '94771234567@s.whatsapp.net',
  },
}));

jest.mock('../src/services/logger.js', () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
  },
}));

jest.mock('../src/services/settings.js', () => ({
  getGlobalSettings: async () => ({ prefix: '.', botName: 'TestBot', blockedUsers: [] }),
  getGroupSettings:  async () => ({
    antilink: { enabled: false, warnings: {}, warnLimit: 3, allowlist: [] },
    welcome:  { enabled: false, message: 'Welcome {user}' },
    goodbye:  { enabled: false, message: 'Goodbye {user}' },
    muted:    false,
    warns:    {},
  }),
  getBlockedUsers: async () => [],
  isBlocked:       async () => false,
}));

import {
  registerCommand,
  getCommand,
  getCommands,
  handleMessage,
  stats,
} from '../src/handler.js';

/* ── Mock socket ─────────────────────────────────────────────────────────── */

function makeMockSock(userJid = '94771234560@s.whatsapp.net') {
  const sent = [];
  return {
    user: { id: userJid },
    sent,
    sendMessage: jest.fn(async (jid, content) => {
      sent.push({ jid, content });
    }),
    groupMetadata: jest.fn(async () => ({
      id: '1234@g.us',
      subject: 'Test Group',
      participants: [
        { id: userJid, admin: null },
        { id: '94771234567@s.whatsapp.net', admin: 'admin' },
      ],
    })),
    readMessages: jest.fn(async () => {}),
  };
}

/* ── Message factory ─────────────────────────────────────────────────────── */

function makeMsg({
  text     = '.ping',
  fromJid  = '94771234568@s.whatsapp.net',
  chatJid  = null,
  fromMe   = false,
  msgId    = `msg_${Math.random()}`,
} = {}) {
  const remoteJid = chatJid ?? fromJid;
  return {
    key: {
      remoteJid,
      fromMe,
      id:          msgId,
      participant: remoteJid.endsWith('@g.us') ? fromJid : undefined,
    },
    message:      { conversation: text },
    pushName:     'Test User',
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}

function makeGroupMsg(opts = {}) {
  return makeMsg({
    chatJid: '1234@g.us',
    ...opts,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Tests
   ══════════════════════════════════════════════════════════════════════════ */

describe('Command Registry', () => {
  it('registers a command and retrieves it by name', () => {
    registerCommand({
      name: 'testcmd',
      aliases: ['tc'],
      description: 'test',
      category: 'Test',
      execute: jest.fn(),
    });
    expect(getCommand('testcmd')).toBeDefined();
  });

  it('retrieves a command by alias', () => {
    expect(getCommand('tc')).toBeDefined();
    expect(getCommand('tc')?.name).toBe('testcmd');
  });

  it('returns undefined for unknown command', () => {
    expect(getCommand('__nonexistent__')).toBeUndefined();
  });

  it('throws when registering invalid command (no execute)', () => {
    expect(() => registerCommand({ name: 'bad' })).toThrow();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Message Parsing', () => {
  it('ignores messages from self (fromMe: true)', async () => {
    const sock = makeMockSock();
    const msg  = makeMsg({ fromMe: true });
    await handleMessage(msg, sock);
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores status broadcasts', async () => {
    const sock = makeMockSock();
    const msg  = makeMsg({ chatJid: 'status@broadcast' });
    await handleMessage(msg, sock);
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores messages with no text (no prefix match)', async () => {
    const sock = makeMockSock();
    const msg  = makeMsg({ text: 'hello world' }); // no prefix
    await handleMessage(msg, sock);
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Command Execution', () => {
  it('dispatches a valid command', async () => {
    const executed = [];
    registerCommand({
      name:    'echotest',
      aliases: [],
      execute: async ({ args }) => executed.push(args.join(' ')),
    });

    const sock = makeMockSock();
    const msg  = makeMsg({ text: '.echotest hello world' });
    await handleMessage(msg, sock);

    expect(executed).toHaveLength(1);
    expect(executed[0]).toBe('hello world');
  });

  it('replies with unknown command message in private chat', async () => {
    const sock = makeMockSock();
    const msg  = makeMsg({ text: '.__totally_unknown_xyz__' });
    await handleMessage(msg, sock);
    // Should send a message about unknown command
    expect(sock.sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ text: expect.stringContaining('Unknown command') }),
      expect.anything(),
    );
  });

  it('does NOT reply with unknown command in groups (to avoid spam)', async () => {
    const sock = makeMockSock();
    const msg  = makeGroupMsg({ text: '.__totally_unknown_xyz__' });
    await handleMessage(msg, sock);
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Permission Checks', () => {
  it('blocks group-only commands in private chat', async () => {
    registerCommand({
      name:      'grouponly_test',
      aliases:   [],
      groupOnly: true,
      execute:   jest.fn(),
    });

    const sock = makeMockSock();
    const msg  = makeMsg({ text: '.grouponly_test' }); // private chat
    await handleMessage(msg, sock);

    expect(sock.sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ text: expect.stringContaining('only be used in a group') }),
      expect.anything(),
    );
  });

  it('blocks owner-only commands for non-owners', async () => {
    registerCommand({
      name:      'owneronly_test',
      aliases:   [],
      ownerOnly: true,
      execute:   jest.fn(),
    });

    const sock = makeMockSock();
    // sender is NOT in ownerNumbers
    const msg  = makeMsg({ text: '.owneronly_test', fromJid: '99999999999@s.whatsapp.net' });
    await handleMessage(msg, sock);

    expect(sock.sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ text: expect.stringContaining('reserved for the bot owner') }),
      expect.anything(),
    );
  });

  it('allows owner-only commands for owners', async () => {
    const executed = [];
    registerCommand({
      name:      'owneronly_allowed',
      aliases:   [],
      ownerOnly: true,
      execute:   async () => executed.push(true),
    });

    const sock = makeMockSock();
    const msg  = makeMsg({
      text:    '.owneronly_allowed',
      fromJid: '94771234567@s.whatsapp.net', // IS owner
    });
    await handleMessage(msg, sock);
    expect(executed).toHaveLength(1);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Cooldown Enforcement', () => {
  it('prevents a second call within cooldown period', async () => {
    const executed = [];
    registerCommand({
      name:     'cooltest',
      aliases:  [],
      cooldown: 10,
      execute:  async () => executed.push(true),
    });

    const sock = makeMockSock();
    const make  = (id) => makeMsg({ text: '.cooltest', msgId: id });

    await handleMessage(make('cd1'), sock);
    await handleMessage(make('cd2'), sock);

    expect(executed).toHaveLength(1); // second call blocked by cooldown
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Deduplication', () => {
  it('does not process the same message ID twice', async () => {
    const executed = [];
    registerCommand({
      name:    'dedup_test',
      aliases: [],
      execute: async () => executed.push(true),
    });

    const sock = makeMockSock();
    const msg  = makeMsg({ text: '.dedup_test', msgId: 'fixed_id_abc' });

    await handleMessage(msg, sock);
    await handleMessage(msg, sock); // exact same object / ID

    expect(executed).toHaveLength(1);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('Owner & Chat Messaging Scenarios', () => {
  it('executes command when owner texts someone else in a 1-on-1 chat', async () => {
    const executed = [];
    registerCommand({
      name:    'ownertest',
      aliases: [],
      execute: async ({ ctx, isOwner }) => executed.push({ chat: ctx.chat, isOwner }),
    });

    // Mock socket where sock.user is the owner
    const sock = makeMockSock('94771234567@s.whatsapp.net');
    // Owner texts friend 94779999999
    const msg  = makeMsg({
      text:    '.ownertest',
      chatJid: '94779999999@s.whatsapp.net',
      fromMe:  true,
    });

    await handleMessage(msg, sock);

    expect(executed).toHaveLength(1);
    expect(executed[0].chat).toBe('94779999999@s.whatsapp.net');
    expect(executed[0].isOwner).toBe(true);
  });

  it('executes prefix-less command in private chat when matching command name', async () => {
    const executed = [];
    registerCommand({
      name:    'prefixless',
      aliases: [],
      execute: async ({ args }) => executed.push(args.join(' ')),
    });

    const sock = makeMockSock();
    const msg  = makeMsg({ text: 'prefixless test arg' }); // no dot

    await handleMessage(msg, sock);

    expect(executed).toHaveLength(1);
    expect(executed[0]).toBe('test arg');
  });
});

