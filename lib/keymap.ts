export type ModKey = 'Ctrl' | 'Meta';

/** Platform string is injected rather than read from navigator so this stays pure. */
export function resolveMod(platform: string): ModKey {
  return /^Mac/i.test(platform) ? 'Meta' : 'Ctrl';
}
