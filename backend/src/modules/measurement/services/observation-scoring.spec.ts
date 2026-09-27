import { describe, expect, it } from 'vitest';
import { extractObservation } from './observation-scoring.js';

const SUBJECT = { name: 'Northwind Robotics', domain: 'northwind.io' };

describe('extractObservation', () => {
  it('detects a full-name mention', () => {
    const r = extractObservation({ text: 'Northwind Robotics builds warehouse robots.', citations: [] }, SUBJECT);
    expect(r.mentioned).toBe(true);
    expect(r.characterization).toBe('present');
  });

  it('detects a bare-brand mention via the longest token (>= 4 chars)', () => {
    const r = extractObservation({ text: 'Northwind makes great picking robots.', citations: [] }, SUBJECT);
    expect(r.mentioned).toBe(true);
  });

  it('detects a domain-host mention with no name match', () => {
    const r = extractObservation({ text: 'Check out northwind.io for details.', citations: [] }, SUBJECT);
    expect(r.mentioned).toBe(true);
  });

  it('reports absent when nothing matches', () => {
    const r = extractObservation({ text: 'Competitor X is the market leader.', citations: [] }, SUBJECT);
    expect(r.mentioned).toBe(false);
    expect(r.characterization).toBe('absent');
  });

  it('finds a citation to the subject domain and its 1-based position', () => {
    const r = extractObservation(
      { text: 'irrelevant', citations: ['https://competitor.com/a', 'https://www.northwind.io/blog/post', 'https://other.com'] },
      SUBJECT,
    );
    expect(r.cited).toBe(true);
    expect(r.citedUrl).toBe('https://www.northwind.io/blog/post');
    expect(r.position).toBe(2);
  });

  it('reports no citation when the subject domain never appears', () => {
    const r = extractObservation({ text: 'x', citations: ['https://competitor.com/a'] }, SUBJECT);
    expect(r.cited).toBe(false);
    expect(r.citedUrl).toBeNull();
    expect(r.position).toBeNull();
  });

  it('only takes the first matching citation, not the last', () => {
    const r = extractObservation(
      { text: 'x', citations: ['https://northwind.io/a', 'https://northwind.io/b'] },
      SUBJECT,
    );
    expect(r.citedUrl).toBe('https://northwind.io/a');
    expect(r.position).toBe(1);
  });

  it('never throws on a malformed citation URL', () => {
    const r = extractObservation({ text: 'x', citations: ['not a url'] }, SUBJECT);
    expect(r.cited).toBe(false);
  });
});
