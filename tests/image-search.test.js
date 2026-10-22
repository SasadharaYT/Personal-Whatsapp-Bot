/**
 * tests/image-search.test.js — Unit tests for Pexels image search and download.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const mockPhotosSearch = jest.fn();
const mockPhotosCurated = jest.fn();

jest.unstable_mockModule('pexels', () => ({
  createClient: jest.fn(() => ({
    photos: {
      search: mockPhotosSearch,
      curated: mockPhotosCurated,
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

const { default: config } = await import('../src/config.js');
const {
  searchPhotos,
  getRandomPhotos,
  downloadImage,
  getCategories,
  getImageServiceStatus,
} = await import('../src/services/image-search.js');

describe('Image Search Service (Pexels)', () => {
  let testTempDir;

  beforeEach(async () => {
    jest.clearAllMocks();
    testTempDir = path.join(os.tmpdir(), `bot_test_img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    await fs.mkdir(testTempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testTempDir, { recursive: true, force: true });
    } catch {}
  });

  it('searches photos and returns normalised results', async () => {
    mockPhotosSearch.mockResolvedValueOnce({
      total_results: 100,
      photos: [
        {
          id: 12345,
          width: 1920,
          height: 1080,
          photographer: 'Jane Doe',
          photographer_url: 'https://pexels.com/@janedoe',
          url: 'https://pexels.com/photos/12345',
          alt: 'Mountain landscape',
          src: {
            large2x: 'https://images.pexels.com/photos/12345/pexels-photo-12345.jpeg',
            large: 'https://images.pexels.com/photos/12345/pexels-photo-12345.jpeg?auto=compress',
            portrait: 'https://images.pexels.com/photos/12345/portrait.jpeg',
          },
        },
      ],
    });

    const res = await searchPhotos('mountains', 'user1@s.whatsapp.net', { orientation: 'portrait' });
    expect(res.success).toBe(true);
    expect(res.photos.length).toBe(1);
    expect(res.photos[0].photographer).toBe('Jane Doe');
    expect(res.photos[0].alt).toBe('Mountain landscape');
  });

  it('handles empty search results cleanly', async () => {
    mockPhotosSearch.mockResolvedValueOnce({
      total_results: 0,
      photos: [],
    });

    const res = await searchPhotos('nonexistentquery12345xyz', 'user1@s.whatsapp.net');
    expect(res.success).toBe(false);
    expect(res.error).toContain('No images found');
  });

  it('fetches curated random photos', async () => {
    mockPhotosCurated.mockResolvedValueOnce({
      photos: [
        {
          id: 999,
          width: 1080,
          height: 1920,
          photographer: 'John Smith',
          photographer_url: 'https://pexels.com/@johnsmith',
          url: 'https://pexels.com/photos/999',
          alt: 'Abstract art',
          src: { large2x: 'https://images.pexels.com/photos/999/large.jpeg' },
        },
      ],
    });

    const res = await getRandomPhotos('user1@s.whatsapp.net', 1);
    expect(res.success).toBe(true);
    expect(res.photos.length).toBe(1);
    expect(res.photos[0].photographer).toBe('John Smith');
  });

  it('returns predefined categories list', () => {
    const cats = getCategories();
    expect(Array.isArray(cats)).toBe(true);
    expect(cats).toContain('nature');
    expect(cats).toContain('minimal');
  });

  it('returns valid image service status', () => {
    const status = getImageServiceStatus();
    expect(status.provider).toBe('Pexels');
    expect(status.configured).toBe(true);
  });

  it('rejects unsafe SSRF URLs during download', async () => {
    const unsafePhotoSrc = {
      large2x: 'http://127.0.0.1:8080/internal.jpg',
    };

    const res = await downloadImage(unsafePhotoSrc, testTempDir);
    expect(res.success).toBe(false);
    expect(res.error).toContain('unsafe');
  });
});

describe('Image Search Service (Pixabay)', () => {
  const originalFetch = global.fetch;
  const originalProvider = config.imageProvider;
  const originalPixabayKey = config.pixabayApiKey;
  const originalPexelsKey = config.pexelsApiKey;

  beforeEach(() => {
    config.imageProvider = 'pixabay';
    config.pixabayApiKey = 'test_pixabay_key';
    config.pexelsApiKey = '';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    config.imageProvider = originalProvider;
    config.pixabayApiKey = originalPixabayKey;
    config.pexelsApiKey = originalPexelsKey;
  });

  it('searches photos via Pixabay and normalises results', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        total: 50,
        totalHits: 50,
        hits: [
          {
            id: 8888,
            imageWidth: 2000,
            imageHeight: 1500,
            user: 'pixabay_artist',
            user_id: 1234,
            pageURL: 'https://pixabay.com/photos/nature-8888/',
            tags: 'nature, landscape, trees',
            webformatURL: 'https://pixabay.com/get/sample_640.jpg',
            largeImageURL: 'https://pixabay.com/get/sample_1280.jpg',
            views: 12000,
            likes: 450,
          },
        ],
      }),
    });

    const res = await searchPhotos('forest', 'user2@s.whatsapp.net', { orientation: 'portrait' });
    expect(res.success).toBe(true);
    expect(res.provider).toBe('Pixabay');
    expect(res.photos.length).toBe(1);
    expect(res.photos[0].photographer).toBe('pixabay_artist');
    expect(res.photos[0].alt).toBe('nature, landscape, trees');
    expect(res.photos[0].src.large).toContain('sample_1280.jpg');

    // Verify fetch URL passed vertical orientation
    const fetchUrl = global.fetch.mock.calls[0][0];
    expect(fetchUrl).toContain('orientation=vertical');
    expect(fetchUrl).toContain('q=forest');
  });

  it('handles empty Pixabay search results cleanly', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ total: 0, totalHits: 0, hits: [] }),
    });

    const res = await searchPhotos('superrandomnonexistentquery', 'user2@s.whatsapp.net');
    expect(res.success).toBe(false);
    expect(res.error).toContain('No images found');
  });

  it('fetches curated random photos via Pixabay', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        total: 100,
        totalHits: 100,
        hits: [
          {
            id: 9999,
            imageWidth: 1920,
            imageHeight: 1080,
            user: 'curated_user',
            user_id: 5678,
            pageURL: 'https://pixabay.com/photos/sample-9999/',
            tags: 'curated, beautiful',
            webformatURL: 'https://pixabay.com/get/sample_curated_640.jpg',
            largeImageURL: 'https://pixabay.com/get/sample_curated_1280.jpg',
          },
        ],
      }),
    });

    const res = await getRandomPhotos('user2@s.whatsapp.net', 1);
    expect(res.success).toBe(true);
    expect(res.provider).toBe('Pixabay');
    expect(res.photos.length).toBe(1);
    expect(res.photos[0].photographer).toBe('curated_user');

    const fetchUrl = global.fetch.mock.calls[0][0];
    expect(fetchUrl).toContain('editors_choice=true');
  });

  it('reports Pixabay as active provider in service status', () => {
    const status = getImageServiceStatus();
    expect(status.provider).toBe('Pixabay');
    expect(status.configured).toBe(true);
  });
});

