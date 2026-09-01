import { describe, expect, it } from 'vitest';
import { resolveMod } from './keymap';

describe('resolveMod', () => {
  it('uses Ctrl off macOS', () => {
    expect(resolveMod('Win32')).toBe('Ctrl');
    expect(resolveMod('Linux x86_64')).toBe('Ctrl');
  });

  it('uses Meta on macOS', () => {
    expect(resolveMod('MacIntel')).toBe('Meta');
  });
});
