/**
 * tests/gemini.test.js — Unit tests for the Gemini AI service.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockGenerateContent = jest.fn();

jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

jest.unstable_mockModule('../src/services/logger.js', () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
  },
}));

const {
  chat,
  translate,
  summarize,
  explain,
  clearHistory,
  getStatus,
  setAiForGroup,
  isAiEnabledForGroup,
} = await import('../src/services/gemini.js');

describe('Gemini AI Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearHistory('user1@s.whatsapp.net', null);
    clearHistory('user1@s.whatsapp.net', 'group1@g.us');
  });

  it('generates a successful chat response', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Hello! I am Gemini, how can I assist you?',
    });

    const res = await chat('user1@s.whatsapp.net', null, 'Hello Gemini');
    expect(res.success).toBe(true);
    expect(res.text).toContain('Hello! I am Gemini');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('maintains conversation history across calls', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ text: 'My name is Gemini.' })
      .mockResolvedValueOnce({ text: 'You asked my name previously.' });

    await chat('user1@s.whatsapp.net', null, 'What is your name?');
    await chat('user1@s.whatsapp.net', null, 'What did I just ask?');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    const secondCallContents = mockGenerateContent.mock.calls[1][0].contents;
    expect(secondCallContents.length).toBeGreaterThan(1);
    expect(secondCallContents[0].role).toBe('user');
    expect(secondCallContents[1].role).toBe('model');
  });

  it('clears conversation history when requested', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ text: 'Response 1' })
      .mockResolvedValueOnce({ text: 'Response 2' });

    await chat('user1@s.whatsapp.net', null, 'First message');
    clearHistory('user1@s.whatsapp.net', null);
    await chat('user1@s.whatsapp.net', null, 'Second message');

    const secondCallContents = mockGenerateContent.mock.calls[1][0].contents;
    expect(secondCallContents.length).toBe(1);
  });

  it('summarize convenience wrapper calls generateContent with concise prompt', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'This is a short summary.',
    });

    const res = await summarize('user1@s.whatsapp.net', 'A very long text about biology and physics');
    expect(res.success).toBe(true);
    expect(res.text).toBe('This is a short summary.');
  });

  it('translate convenience wrapper translates text', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Hola Mundo',
    });

    const res = await translate('user1@s.whatsapp.net', 'Hello World', 'Spanish');
    expect(res.success).toBe(true);
    expect(res.text).toBe('Hola Mundo');
  });

  it('explain convenience wrapper explains concepts simply', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Quantum computing uses qubits instead of bits.',
    });

    const res = await explain('user1@s.whatsapp.net', 'Quantum computing');
    expect(res.success).toBe(true);
    expect(res.text).toContain('qubits');
  });

  it('handles safety block error appropriately', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('SAFETY: response was blocked'));

    const res = await chat('user1@s.whatsapp.net', null, 'Blocked question');
    expect(res.success).toBe(false);
    expect(res.error).toContain('safety filters');
  });

  it('handles quota / rate limit errors cleanly', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('RESOURCE_EXHAUSTED: quota exceeded'));

    const res = await chat('user1@s.whatsapp.net', null, 'Question');
    expect(res.success).toBe(false);
    expect(res.error).toContain('quota exhausted');
  });

  it('checks and updates group-level AI settings', async () => {
    await setAiForGroup('test_group_123@g.us', false);
    const enabled = await isAiEnabledForGroup('test_group_123@g.us');
    expect(enabled).toBe(false);

    const res = await chat('user1@s.whatsapp.net', 'test_group_123@g.us', 'Hello');
    expect(res.success).toBe(false);
    expect(res.error).toContain('disabled in this group');

    // Re-enable
    await setAiForGroup('test_group_123@g.us', true);
    expect(await isAiEnabledForGroup('test_group_123@g.us')).toBe(true);
  });

  it('returns valid status structure', () => {
    const status = getStatus();
    expect(status).toHaveProperty('enabled');
    expect(status).toHaveProperty('configured');
    expect(status).toHaveProperty('model');
    expect(status).toHaveProperty('activeConversations');
  });
});
