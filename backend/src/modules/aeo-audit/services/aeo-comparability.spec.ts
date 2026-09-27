import { describe, expect, it } from 'vitest';
import { areAuditsComparable, auditComparabilityKey } from './aeo-comparability.js';

describe('auditComparabilityKey', () => {
  it('is null when querySetId is missing', () => {
    expect(auditComparabilityKey({ querySetId: null, surfaces: ['cloro_chatgpt'], markets: ['US'] })).toBeNull();
  });
  it('is order-independent for surfaces and markets', () => {
    const a = auditComparabilityKey({ querySetId: 'qs-1', surfaces: ['cloro_chatgpt', 'cloro_gemini'], markets: ['US', 'GB'] });
    const b = auditComparabilityKey({ querySetId: 'qs-1', surfaces: ['cloro_gemini', 'cloro_chatgpt'], markets: ['GB', 'US'] });
    expect(a).toBe(b);
  });
  it('differs when the query set differs', () => {
    const a = auditComparabilityKey({ querySetId: 'qs-1', surfaces: ['cloro_chatgpt'], markets: ['US'] });
    const b = auditComparabilityKey({ querySetId: 'qs-2', surfaces: ['cloro_chatgpt'], markets: ['US'] });
    expect(a).not.toBe(b);
  });
});

describe('areAuditsComparable', () => {
  it('is true for identical question/engine/market sets', () => {
    const a = { querySetId: 'qs-1', surfaces: ['cloro_chatgpt'], markets: ['US'] };
    const b = { querySetId: 'qs-1', surfaces: ['cloro_chatgpt'], markets: ['US'] };
    expect(areAuditsComparable(a, b)).toBe(true);
  });
  it('is false when either side has no querySetId — a methodology break, never diffed', () => {
    const a = { querySetId: null, surfaces: ['cloro_chatgpt'], markets: ['US'] };
    const b = { querySetId: 'qs-1', surfaces: ['cloro_chatgpt'], markets: ['US'] };
    expect(areAuditsComparable(a, b)).toBe(false);
  });
  it('is false when surfaces differ — different engine set is a methodology break', () => {
    const a = { querySetId: 'qs-1', surfaces: ['cloro_chatgpt'], markets: ['US'] };
    const b = { querySetId: 'qs-1', surfaces: ['cloro_gemini'], markets: ['US'] };
    expect(areAuditsComparable(a, b)).toBe(false);
  });
});
