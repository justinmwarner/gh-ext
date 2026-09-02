/**
 * The platform string, read in exactly one place.
 *
 * `resolveMod` owns the *decision* about which modifier this platform uses and
 * is the only thing allowed to make it; this is only the reading. Keeping the
 * read here as well means neither half is spelled out twice, and a test can see
 * what a keymap would see.
 *
 * `navigator.platform` is deprecated but is still the only synchronous answer
 * — `userAgentData` is asynchronous, absent in Firefox, and unavailable on the
 * first keystroke, which is the one that has to work.
 */
export function platformString(): string {
  return typeof navigator === 'undefined' ? '' : navigator.platform;
}
