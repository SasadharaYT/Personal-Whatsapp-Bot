/**
 * tests/ai-commands.test.js — Tests for AI command module.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockChat = jest.fn();
const mockTranslate = jest.fn();
const mockSummarize = jest.fn();
const mockExplain = jest.fn();
const mockClearHistory = jest.fn();
const mockGetStatus = jest.fn().mockReturnValue({
  enabled: true,
  configured: true,
  model: 'gemini-2.0-flash',
  activeConversations: 0,
});

jest.unstable_mockModule('../src/services/gemini.js', () => ({
  chat: mockChat,
  translate: mockTranslate,
  summarize: mockSummarize,
  explain: mockExplain,
  clearHistory: mockClearHistory,
  getStatus: mockGetStatus,
}));

const { default: aiCommands } = await import('../src/commands/ai.js');

function makeContext(args = [], text = '') {
  return {
    sock: {
      sendMessage: jest.fn().mockResolvedValue({ key: { id: 'sent_123' } }),
    },
    ctx: {
      sender: '94771234568@s.whatsapp.net',
      chat: '94771234568@s.whatsapp.net',
      isGroup: false,
      raw: {
        message: {
          conversation: text,
        },
      },
    },
    args,
    prefix: '.',
  };
}

describe('AI Commands Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exports an array of command definitions', () => {
    expect(Array.isArray(aiCommands)).toBe(true);
    const names = aiCommands.map(c => c.name);
    expect(names).toContain('ai');
    expect(names).toContain('summarize');
    expect(names).toContain('translate');
    expect(names).toContain('explain');
    expect(names).toContain('clearai');
    expect(names).toContain('aistatus');
    expect(names).toContain('aihelp');
  });

  it('ai command prompts for question if no args provided', async () => {
    const cmd = aiCommands.find(c => c.name === 'ai');
    const { sock, ctx, args, prefix } = makeContext([]);

    await cmd.execute({ sock, ctx, args, prefix });
    expect(sock.sendMessage).toHaveBeenCalled();
    const sentText = sock.sendMessage.mock.calls[0][1].text;
    expect(sentText).toContain('Usage:');
  });

  it('ai command chats with Gemini when text is provided', async () => {
    const cmd = aiCommands.find(c => c.name === 'ai');
    const { sock, ctx, prefix } = makeContext(['What', 'is', 'gravity?']);
    mockChat.mockResolvedValueOnce({ success: true, text: 'Gravity is a fundamental force.' });

    await cmd.execute({ sock, ctx, args: ['What', 'is', 'gravity?'], prefix });
    expect(mockChat).toHaveBeenCalledWith('94771234568@s.whatsapp.net', null, 'What is gravity?');
    expect(sock.sendMessage).toHaveBeenCalledTimes(2); // 'Thinking...' + response
  });

  it('summarize command calls summarize service', async () => {
    const cmd = aiCommands.find(c => c.name === 'summarize');
    const { sock, ctx, prefix } = makeContext(['Long', 'story', 'here']);
    mockSummarize.mockResolvedValueOnce({ success: true, text: 'Brief summary' });

    await cmd.execute({ sock, ctx, args: ['Long', 'story', 'here'], prefix });
    expect(mockSummarize).toHaveBeenCalledWith('94771234568@s.whatsapp.net', 'Long story here');
  });

  it('translate command requires target language', async () => {
    const cmd = aiCommands.find(c => c.name === 'translate');
    const { sock, ctx, prefix } = makeContext([]);

    await cmd.execute({ sock, ctx, args: [], prefix });
    const sentText = sock.sendMessage.mock.calls[0][1].text;
    expect(sentText).toContain('Usage:');
  });

  it('translate command translates given language and text', async () => {
    const cmd = aiCommands.find(c => c.name === 'translate');
    const { sock, ctx, prefix } = makeContext(['French', 'Hello']);
    mockTranslate.mockResolvedValueOnce({ success: true, text: 'Bonjour' });

    await cmd.execute({ sock, ctx, args: ['French', 'Hello'], prefix });
    expect(mockTranslate).toHaveBeenCalledWith('94771234568@s.whatsapp.net', 'Hello', 'French');
  });

  it('explain command calls explain service', async () => {
    const cmd = aiCommands.find(c => c.name === 'explain');
    const { sock, ctx, prefix } = makeContext(['photosynthesis']);
    mockExplain.mockResolvedValueOnce({ success: true, text: 'How plants make food.' });

    await cmd.execute({ sock, ctx, args: ['photosynthesis'], prefix });
    expect(mockExplain).toHaveBeenCalledWith('94771234568@s.whatsapp.net', 'photosynthesis');
  });

  it('clearai command clears conversation history', async () => {
    const cmd = aiCommands.find(c => c.name === 'clearai');
    const { sock, ctx } = makeContext();

    await cmd.execute({ sock, ctx });
    expect(mockClearHistory).toHaveBeenCalledWith('94771234568@s.whatsapp.net', null);
  });

  it('aistatus command displays service status', async () => {
    const cmd = aiCommands.find(c => c.name === 'aistatus');
    const { sock, ctx } = makeContext();

    await cmd.execute({ sock, ctx });
    const sentText = sock.sendMessage.mock.calls[0][1].text;
    expect(sentText).toContain('Gemini AI Status');
    expect(sentText).toContain('gemini-2.0-flash');
  });
});
