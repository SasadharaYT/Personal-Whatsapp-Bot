/**
 * tests/ollama.test.js — Unit tests for the Ollama Cloud AI service.
 */

import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';

const mockFetch = jest.fn();
const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch;

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
} = await import('../src/services/ollama.js');

function mockResponse(content, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => status >= 400
      ? { error: { message: content } }
      : { choices: [{ message: { content } }] },
  };
}

describe('Ollama Cloud AI Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearHistory('user1@s.whatsapp.net', null);
    clearHistory('user1@s.whatsapp.net', 'group1@g.us');
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends chat completions to Ollama Cloud with the configured model and key', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('Hello! I can help.'));

    const res = await chat('user1@s.whatsapp.net', null, 'Hello');

    expect(res).toEqual({ success: true, text: 'Hello! I can help.' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://ollama.com/v1/chat/completions');
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test_ollama_key_123');
    const request = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(request.model).toBe('gemma4:31b-cloud');
    expect(request.stream).toBe(false);
    expect(request.messages.map(message => message.role)).toEqual(['system', 'user']);
  });

  it('maintains conversation history across calls', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse('My name is Gemma.'))
      .mockResolvedValueOnce(mockResponse('You asked my name previously.'));

    await chat('user1@s.whatsapp.net', null, 'What is your name?');
    await chat('user1@s.whatsapp.net', null, 'What did I just ask?');

    const secondCallMessages = JSON.parse(mockFetch.mock.calls[1][1].body).messages;
    expect(secondCallMessages.map(message => message.role)).toEqual([
      'system', 'user', 'assistant', 'user',
    ]);
  });

  it('clears conversation history when requested', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse('Response 1'))
      .mockResolvedValueOnce(mockResponse('Response 2'));

    await chat('user1@s.whatsapp.net', null, 'First message');
    clearHistory('user1@s.whatsapp.net', null);
    await chat('user1@s.whatsapp.net', null, 'Second message');

    const secondCallMessages = JSON.parse(mockFetch.mock.calls[1][1].body).messages;
    expect(secondCallMessages.map(message => message.role)).toEqual(['system', 'user']);
  });

  it('summarize convenience wrapper sends a concise prompt without history', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('This is a short summary.'));

    const res = await summarize('user1@s.whatsapp.net', 'A very long text about biology and physics');
    expect(res.success).toBe(true);
    expect(res.text).toBe('This is a short summary.');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).messages[1].content).toContain('Summarise');
  });

  it('translate convenience wrapper translates text', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('Hola Mundo'));

    const res = await translate('user1@s.whatsapp.net', 'Hello World', 'Spanish');
    expect(res.success).toBe(true);
    expect(res.text).toBe('Hola Mundo');
  });

  it('explain convenience wrapper explains concepts simply', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('Quantum computing uses qubits instead of bits.'));

    const res = await explain('user1@s.whatsapp.net', 'Quantum computing');
    expect(res.success).toBe(true);
    expect(res.text).toContain('qubits');
  });

  it('handles safety block errors appropriately', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('SAFETY: response was blocked', 400));

    const res = await chat('user1@s.whatsapp.net', null, 'Blocked question');
    expect(res.success).toBe(false);
    expect(res.error).toContain('safety filters');
  });

  it('handles quota and rate limit errors cleanly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('rate limit exceeded', 429));

    const res = await chat('user1@s.whatsapp.net', null, 'Question');
    expect(res.success).toBe(false);
    expect(res.error).toContain('rate limit or quota');
  });

  it('checks and updates group-level AI settings', async () => {
    await setAiForGroup('test_group_123@g.us', false);
    const enabled = await isAiEnabledForGroup('test_group_123@g.us');
    expect(enabled).toBe(false);

    const res = await chat('user1@s.whatsapp.net', 'test_group_123@g.us', 'Hello');
    expect(res.success).toBe(false);
    expect(res.error).toContain('disabled in this group');

    await setAiForGroup('test_group_123@g.us', true);
    expect(await isAiEnabledForGroup('test_group_123@g.us')).toBe(true);
  });

  it('returns the configured provider status and model', () => {
    expect(getStatus()).toMatchObject({
      enabled: true,
      configured: true,
      model: 'gemma4:31b-cloud',
      activeConversations: 0,
    });
  });
});
