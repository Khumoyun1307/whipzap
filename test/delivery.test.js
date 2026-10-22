import { describe, it, expect } from 'vitest';
import { formatForDelivery, sanitizeForTyping, DELIVERY_MODES } from '../src/main/delivery.js';

describe('delivery', () => {
  it('DLV-01 safe mode returns the message', () => {
    expect(formatForDelivery('FASTER!', 'safe')).toBe('FASTER!');
  });

  it('DLV-02 btw mode prefixes /btw', () => {
    expect(formatForDelivery('FASTER!', 'btw')).toBe('/btw FASTER!');
  });

  it('DLV-03 trims in both modes', () => {
    expect(formatForDelivery('  FASTER!  ', 'safe')).toBe('FASTER!');
    expect(formatForDelivery('  FASTER!  ', 'btw')).toBe('/btw FASTER!');
  });

  it('DLV-04 rejects newlines', () => {
    expect(() => formatForDelivery('FAST\nER', 'safe')).toThrow();
    expect(() => formatForDelivery('FAST\rER', 'btw')).toThrow();
  });

  it('DLV-05 rejects empty', () => {
    expect(() => formatForDelivery('', 'safe')).toThrow();
    expect(() => formatForDelivery('   ', 'safe')).toThrow();
  });

  it('DLV-06 rejects unknown modes (there is no interrupting mode)', () => {
    expect(() => formatForDelivery('FASTER!', 'crack')).toThrow();
    expect(() => formatForDelivery('FASTER!', 'interrupt')).toThrow();
    expect(() => formatForDelivery('FASTER!', 'esc')).toThrow();
    expect(DELIVERY_MODES).toEqual(['safe', 'btw']);
  });

  it('DLV-07 unicode passes through in safe mode', () => {
    expect(formatForDelivery('Schneller! 🐢', 'safe')).toBe('Schneller! 🐢');
  });

  it('DLV-08 leading slash in safe mode gets a leading space', () => {
    expect(formatForDelivery('/faster', 'safe')).toBe(' /faster');
    expect(formatForDelivery('/faster', 'btw')).toBe('/btw /faster');
  });

  describe('sanitizeForTyping', () => {
    it('strips control characters and collapses whitespace', () => {
      // Control characters (including tab and newlines) are removed, not replaced; runs of spaces collapse.
      expect(sanitizeForTyping('a\tb\r\nc\u0007d  e\u009Ff')).toBe('abcd ef');
      expect(sanitizeForTyping('one   two \u0000 three')).toBe('one two three');
    });
    it('keeps unicode and emoji', () => {
      expect(sanitizeForTyping('ünï 🐢 日本')).toBe('ünï 🐢 日本');
    });
    it('caps at 200 characters', () => {
      expect(sanitizeForTyping('x'.repeat(500))).toHaveLength(200);
    });
    it('trims', () => {
      expect(sanitizeForTyping('   hi   ')).toBe('hi');
    });
  });
});
