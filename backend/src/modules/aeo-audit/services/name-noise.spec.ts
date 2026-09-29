import { describe, expect, it } from 'vitest';
import { cleanBrandName } from './name-noise.js';

describe('cleanBrandName', () => {
  it('strips a source domain glued onto the brand', () => {
    expect(cleanBrandName('Woohoowoohoo.in')).toBe('Woohoo');
    expect(cleanBrandName('GyFTRgyftr.com')).toBe('GyFTR');
    expect(cleanBrandName('Gyftpegyftpe.com')).toBe('Gyftpe');
    expect(cleanBrandName('CardCashcardcash.com')).toBe('CardCash');
  });

  it('leaves ordinary names, and names that merely contain a dot, alone', () => {
    expect(cleanBrandName('Woohoo')).toBe('Woohoo');
    expect(cleanBrandName('Amazon Gift Cards')).toBe('Amazon Gift Cards');
    expect(cleanBrandName('Booking.com')).toBe('Booking.com');
    expect(cleanBrandName("Domino's")).toBe("Domino's");
  });
});
