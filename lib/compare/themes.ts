/**
 * Every syntax theme the diff can be drawn in.
 *
 * Pure data, and the reason it lives here rather than beside the options page:
 * the settings validator has to recognise a stored id without a browser, and
 * the review page has to hand one to Pierre. Both read this list.
 *
 * **All of these are already in the bundle.** Shiki's themes and Pierre's own
 * are emitted as separate lazy chunks by the build, so offering seventy-five
 * costs nothing over offering one — only the chosen theme is ever fetched.
 * That is what makes a free list affordable rather than a curated handful.
 *
 * `mode` is each theme's own declaration, read out of its JSON rather than
 * guessed from its name: `nord` and `poimandres` are dark and say so nowhere in
 * the name, and `vitesse-black` would defeat any heuristic. It groups the list;
 * it does not restrict when a theme may be used. A reviewer who wants Dracula
 * on a white page gets Dracula on a white page.
 */

export interface DiffTheme {
  /** What Pierre and Shiki know it by. Stored verbatim in settings. */
  id: string;
  /** What the options page calls it. */
  label: string;
  /** Which page mode the theme was built for. Groups the list. */
  mode: 'light' | 'dark';
}

/**
 * The four themes built for colour vision deficiency, offered first and named
 * as such.
 *
 * These are why this setting is worth having rather than a nicety. PRODUCT.md
 * is blunt about it: a diff tool that encodes its primary signal in red and
 * green is unusable for the commonest form of colour vision deficiency. Pierre
 * ships themes that answer exactly that, and until now nothing in this
 * extension could reach them.
 */
export const ACCESSIBLE_THEMES: readonly DiffTheme[] = [
  { id: 'pierre-light-protanopia-deuteranopia', label: 'Pierre light protanopia deuteranopia', mode: 'light' },
  { id: 'pierre-dark-protanopia-deuteranopia', label: 'Pierre dark protanopia deuteranopia', mode: 'dark' },
  { id: 'pierre-light-tritanopia', label: 'Pierre light tritanopia', mode: 'light' },
  { id: 'pierre-dark-tritanopia', label: 'Pierre dark tritanopia', mode: 'dark' },
];

/** Built for a light page. */
export const LIGHT_THEMES: readonly DiffTheme[] = [
  { id: 'pierre-light', label: 'Pierre light', mode: 'light' },
  { id: 'pierre-light-soft', label: 'Pierre light soft', mode: 'light' },
  { id: 'pierre-light-vibrant', label: 'Pierre light vibrant', mode: 'light' },
  { id: 'ayu-light', label: 'Ayu light', mode: 'light' },
  { id: 'catppuccin-latte', label: 'Catppuccin latte', mode: 'light' },
  { id: 'everforest-light', label: 'Everforest light', mode: 'light' },
  { id: 'github-light-default', label: 'GitHub light default', mode: 'light' },
  { id: 'github-light-high-contrast', label: 'GitHub light high contrast', mode: 'light' },
  { id: 'github-light', label: 'GitHub light', mode: 'light' },
  { id: 'gruvbox-light-hard', label: 'Gruvbox light hard', mode: 'light' },
  { id: 'gruvbox-light-medium', label: 'Gruvbox light medium', mode: 'light' },
  { id: 'gruvbox-light-soft', label: 'Gruvbox light soft', mode: 'light' },
  { id: 'horizon-bright', label: 'Horizon bright', mode: 'light' },
  { id: 'kanagawa-lotus', label: 'Kanagawa lotus', mode: 'light' },
  { id: 'light-plus', label: 'Light plus', mode: 'light' },
  { id: 'material-theme-lighter', label: 'Material theme lighter', mode: 'light' },
  { id: 'min-light', label: 'Min light', mode: 'light' },
  { id: 'night-owl-light', label: 'Night Owl light', mode: 'light' },
  { id: 'one-light', label: 'One light', mode: 'light' },
  { id: 'rose-pine-dawn', label: 'Rose Pine Dawn', mode: 'light' },
  { id: 'slack-ochin', label: 'Slack ochin', mode: 'light' },
  { id: 'snazzy-light', label: 'Snazzy light', mode: 'light' },
  { id: 'solarized-light', label: 'Solarized light', mode: 'light' },
  { id: 'vitesse-light', label: 'Vitesse light', mode: 'light' },
];

/** Built for a dark page. */
export const DARK_THEMES: readonly DiffTheme[] = [
  { id: 'pierre-dark', label: 'Pierre dark', mode: 'dark' },
  { id: 'pierre-dark-soft', label: 'Pierre dark soft', mode: 'dark' },
  { id: 'pierre-dark-vibrant', label: 'Pierre dark vibrant', mode: 'dark' },
  { id: 'andromeeda', label: 'Andromeeda', mode: 'dark' },
  { id: 'aurora-x', label: 'Aurora x', mode: 'dark' },
  { id: 'ayu-dark', label: 'Ayu dark', mode: 'dark' },
  { id: 'ayu-mirage', label: 'Ayu mirage', mode: 'dark' },
  { id: 'catppuccin-frappe', label: 'Catppuccin frappe', mode: 'dark' },
  { id: 'catppuccin-macchiato', label: 'Catppuccin macchiato', mode: 'dark' },
  { id: 'catppuccin-mocha', label: 'Catppuccin mocha', mode: 'dark' },
  { id: 'dark-plus', label: 'Dark plus', mode: 'dark' },
  { id: 'dracula-soft', label: 'Dracula soft', mode: 'dark' },
  { id: 'dracula', label: 'Dracula', mode: 'dark' },
  { id: 'everforest-dark', label: 'Everforest dark', mode: 'dark' },
  { id: 'github-dark-default', label: 'GitHub dark default', mode: 'dark' },
  { id: 'github-dark-dimmed', label: 'GitHub dark dimmed', mode: 'dark' },
  { id: 'github-dark-high-contrast', label: 'GitHub dark high contrast', mode: 'dark' },
  { id: 'github-dark', label: 'GitHub dark', mode: 'dark' },
  { id: 'gruvbox-dark-hard', label: 'Gruvbox dark hard', mode: 'dark' },
  { id: 'gruvbox-dark-medium', label: 'Gruvbox dark medium', mode: 'dark' },
  { id: 'gruvbox-dark-soft', label: 'Gruvbox dark soft', mode: 'dark' },
  { id: 'horizon', label: 'Horizon', mode: 'dark' },
  { id: 'houston', label: 'Houston', mode: 'dark' },
  { id: 'kanagawa-dragon', label: 'Kanagawa dragon', mode: 'dark' },
  { id: 'kanagawa-wave', label: 'Kanagawa wave', mode: 'dark' },
  { id: 'laserwave', label: 'LaserWave', mode: 'dark' },
  { id: 'material-theme-darker', label: 'Material theme darker', mode: 'dark' },
  { id: 'material-theme-ocean', label: 'Material theme ocean', mode: 'dark' },
  { id: 'material-theme-palenight', label: 'Material theme palenight', mode: 'dark' },
  { id: 'material-theme', label: 'Material theme', mode: 'dark' },
  { id: 'min-dark', label: 'Min dark', mode: 'dark' },
  { id: 'monokai', label: 'Monokai', mode: 'dark' },
  { id: 'night-owl', label: 'Night Owl', mode: 'dark' },
  { id: 'nord', label: 'Nord', mode: 'dark' },
  { id: 'one-dark-pro', label: 'One dark pro', mode: 'dark' },
  { id: 'plastic', label: 'Plastic', mode: 'dark' },
  { id: 'poimandres', label: 'Poimandres', mode: 'dark' },
  { id: 'red', label: 'Red', mode: 'dark' },
  { id: 'rose-pine-moon', label: 'Rose Pine Moon', mode: 'dark' },
  { id: 'rose-pine', label: 'Rose Pine', mode: 'dark' },
  { id: 'slack-dark', label: 'Slack dark', mode: 'dark' },
  { id: 'solarized-dark', label: 'Solarized dark', mode: 'dark' },
  { id: 'synthwave-84', label: 'Synthwave 84', mode: 'dark' },
  { id: 'tokyo-night', label: 'Tokyo Night', mode: 'dark' },
  { id: 'vesper', label: 'Vesper', mode: 'dark' },
  { id: 'vitesse-black', label: 'Vitesse black', mode: 'dark' },
  { id: 'vitesse-dark', label: 'Vitesse dark', mode: 'dark' },
];

/** Every theme, in the order the options page offers them. */
export const DIFF_THEMES: readonly DiffTheme[] = [
  ...ACCESSIBLE_THEMES,
  ...LIGHT_THEMES,
  ...DARK_THEMES,
];

/**
 * The empty string, meaning "whatever Pierre would have done".
 *
 * Not a theme id, and deliberately not one. Left unset, Pierre uses its own
 * light/dark pair and follows the page — the behaviour every existing install
 * already has. Writing today's default into storage instead would freeze it for
 * everyone and make a later change to it invisible.
 */
export const THEME_FOLLOWS_PAGE = '';

const BY_ID = new Map(DIFF_THEMES.map((theme) => [theme.id, theme]));

/** Is this a theme this build can actually draw? */
export function isDiffTheme(value: unknown): value is string {
  return (
    typeof value === 'string' && (value === THEME_FOLLOWS_PAGE || BY_ID.has(value))
  );
}

/** The theme with this id, or null for the default and for anything unknown. */
export function diffTheme(id: string): DiffTheme | null {
  return BY_ID.get(id) ?? null;
}
