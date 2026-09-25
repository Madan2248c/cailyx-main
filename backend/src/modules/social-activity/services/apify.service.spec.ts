import { describe, expect, it } from 'vitest';
import { buildInput, normalizeItem } from './apify.service.js';

describe('buildInput', () => {
  it('points linkedin posts at company page URLs with a cap', () => {
    expect(
      buildInput('linkedin', 'posts', { platform: 'linkedin', url: 'https://linkedin.com/company/acme', handle: 'acme' }, 20),
    ).toEqual({ targetUrls: ['https://linkedin.com/company/acme'], maxPosts: 20 });
  });
  it('uses twitterHandles (not handles) with a 30d window for x', () => {
    const input = buildInput('x', 'posts', { platform: 'x', url: 'https://x.com/acme', handle: 'acme' }, 20) as Record<string, unknown>;
    expect(input.twitterHandles).toEqual(['acme']);
    expect(input.within_time).toBe('30d');
    expect(input).not.toHaveProperty('handles');
  });
  it('falls back to handle when url is missing', () => {
    expect(
      buildInput('instagram', 'profile', { platform: 'instagram', url: null, handle: 'acme' }, 20),
    ).toEqual({ usernames: ['acme'] });
  });
});

describe('normalizeItem', () => {
  it('tries candidate field names per metric', () => {
    const item = normalizeItem('x', 'posts', 'xquik/x-tweet-scraper', {
      text: 'hello',
      favoriteCount: 5,
      replyCount: 2,
      retweetCount: 1,
      timestamp: 1_700_000_000,
    });
    expect(item.caption).toBe('hello');
    expect(item.likeCount).toBe(5);
    expect(item.commentCount).toBe(2);
    expect(item.shareCount).toBe(1);
    expect(item.postedAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });
  it('yields nulls — never guesses — for absent fields', () => {
    const item = normalizeItem('linkedin', 'posts', 'harvestapi/linkedin-company-posts', { text: 'hi' });
    expect(item.likeCount).toBeNull();
    expect(item.postedAt).toBeNull();
    expect(item.url).toBeNull();
  });
  it('unwraps nested date objects', () => {
    const item = normalizeItem('linkedin', 'posts', 'a/b', {
      timestamp: { date: '2026-09-01T00:00:00Z', postedAgoText: '3w' },
    });
    expect(item.postedAt).toBe('2026-09-01T00:00:00.000Z');
  });
  it('keeps actor provenance and raw payload', () => {
    const item = normalizeItem('instagram', 'profile', 'apify/instagram-profile-scraper', { followers: 42 });
    expect(item.actorId).toBe('apify/instagram-profile-scraper');
    expect(item.kind).toBe('profile');
    expect(item.followerCount).toBe(42);
    expect(JSON.parse(item.raw)).toEqual({ followers: 42 });
  });
});
