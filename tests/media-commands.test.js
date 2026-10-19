/**
 * tests/media-commands.test.js — Tests for Media, Image, and System command modules.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockGetVideoInfo = jest.fn();
const mockDownload = jest.fn();
const mockSearchPhotos = jest.fn();
const mockGetRandomPhotos = jest.fn();
const mockGetActiveJobs = jest.fn().mockReturnValue([]);
const mockCancelJob = jest.fn();
const mockGetDownloaderStatus = jest.fn().mockResolvedValue({
  ytDlpInstalled: true,
  ffmpegInstalled: true,
  activeJobs: 0,
});
const mockGetImageServiceStatus = jest.fn().mockReturnValue({
  configured: true,
  provider: 'Pexels',
});
const mockGetCategories = jest.fn().mockReturnValue(['nature', 'space']);

jest.unstable_mockModule('../src/services/media-downloader.js', () => ({
  getVideoInfo: mockGetVideoInfo,
  download: mockDownload,
  getActiveJobs: mockGetActiveJobs,
  cancelJob: mockCancelJob,
  getDownloaderStatus: mockGetDownloaderStatus,
}));

jest.unstable_mockModule('../src/services/image-search.js', () => ({
  searchPhotos: mockSearchPhotos,
  getRandomPhotos: mockGetRandomPhotos,
  downloadImage: jest.fn(),
  getImageServiceStatus: mockGetImageServiceStatus,
  getCategories: mockGetCategories,
}));

jest.unstable_mockModule('../src/services/gemini.js', () => ({
  getStatus: jest.fn().mockReturnValue({ enabled: true, configured: true, model: 'gemini-2.0-flash' }),
  setAiForGroup: jest.fn(),
  isAiEnabledForGroup: jest.fn().mockResolvedValue(true),
}));

const { default: mediaCommands } = await import('../src/commands/media.js');
const { default: imageCommands } = await import('../src/commands/image.js');
const { default: systemCommands } = await import('../src/commands/system.js');

function makeContext(args = []) {
  return {
    sock: {
      sendMessage: jest.fn().mockResolvedValue({ key: { id: 'sent_media_123' } }),
    },
    ctx: {
      sender: '94771234568@s.whatsapp.net',
      chat: '94771234568@s.whatsapp.net',
      isGroup: false,
      raw: {
        message: { conversation: '' },
      },
    },
    args,
    prefix: '.',
    isOwner: false,
    isAdmin: false,
  };
}

describe('Media Commands Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ytinfo requires a URL', async () => {
    const cmd = mediaCommands.find(c => c.name === 'ytinfo');
    const { sock, ctx, args, prefix } = makeContext([]);

    await cmd.execute({ sock, ctx, args, prefix });
    const text = sock.sendMessage.mock.calls[0][1].text;
    expect(text).toContain('Usage:');
  });

  it('ytinfo displays video metadata when valid URL is passed', async () => {
    const cmd = mediaCommands.find(c => c.name === 'ytinfo');
    const { sock, ctx, prefix } = makeContext(['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
    mockGetVideoInfo.mockResolvedValueOnce({
      success: true,
      info: {
        title: 'Rick Astley - Never Gonna Give You Up',
        channel: 'Rick Astley',
        durationStr: '3:32',
        viewCount: 1500000000,
        uploadDate: '2009-10-25',
      },
    });

    await cmd.execute({ sock, ctx, args: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'], prefix });
    expect(mockGetVideoInfo).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const sentText = sock.sendMessage.mock.calls[1][1].text;
    expect(sentText).toContain('Rick Astley');
  });

  it('ythelp displays YouTube downloader guide', async () => {
    const cmd = mediaCommands.find(c => c.name === 'ythelp');
    const { sock, ctx, prefix } = makeContext([]);

    await cmd.execute({ sock, ctx, prefix });
    const sentText = sock.sendMessage.mock.calls[0][1].text;
    expect(sentText).toContain('YouTube Media Downloader Help');
  });
});

describe('Image Commands Module', () => {
  it('image command prompts for search term when args are empty', async () => {
    const cmd = imageCommands.find(c => c.name === 'image');
    const { sock, ctx, prefix } = makeContext([]);

    await cmd.execute({ sock, ctx, args: [], prefix });
    const sentText = sock.sendMessage.mock.calls[0][1].text;
    expect(sentText).toContain('Usage:');
  });

  it('imagehelp displays categories and instructions', async () => {
    const cmd = imageCommands.find(c => c.name === 'imagehelp');
    const { sock, ctx, prefix } = makeContext([]);

    await cmd.execute({ sock, ctx, prefix });
    const sentText = sock.sendMessage.mock.calls[0][1].text;
    expect(sentText).toContain('Wallpaper & Image Search Help');
    expect(sentText).toContain('nature');
  });
});

describe('System Commands Module', () => {
  it('health command outputs system health report', async () => {
    const cmd = systemCommands.find(c => c.name === 'health');
    const { sock, ctx } = makeContext([]);

    await cmd.execute({ sock, ctx });
    const sentText = sock.sendMessage.mock.calls[0][1].text;
    expect(sentText).toContain('System Health');
    expect(sentText).toContain('Gemini AI:');
    expect(sentText).toContain('yt-dlp:');
  });

  it('mediaqueue reports empty queue when no jobs active', async () => {
    const cmd = systemCommands.find(c => c.name === 'mediaqueue');
    const { sock, ctx, prefix } = makeContext([]);

    await cmd.execute({ sock, ctx, prefix });
    const sentText = sock.sendMessage.mock.calls[0][1].text;
    expect(sentText).toContain('No active downloads');
  });

  it('cancelmedia requires job ID', async () => {
    const cmd = systemCommands.find(c => c.name === 'cancelmedia');
    const { sock, ctx, prefix } = makeContext([]);

    await cmd.execute({ sock, ctx, args: [], prefix, isOwner: false, isAdmin: false });
    const sentText = sock.sendMessage.mock.calls[0][1].text;
    expect(sentText).toContain('Usage:');
  });
});
