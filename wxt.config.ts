import { defineConfig } from 'wxt';

/**
 * Pins the extension id to kpjeagilmchpoganlnllmhloplapcnoj on every machine.
 * Without it Chrome derives a fresh id per unpacked install, so the same
 * extension looks like a different one on each computer.
 *
 * This is the *public* half of the pair and is safe in a public repo — it is
 * what Chrome hashes to get the id. The private key is only needed to pack a
 * .crx, which this project does not do, so it was never committed.
 *
 * The store assigns its own id, which is why this is omitted there. That also
 * means a store install cannot see what an unpacked install saved: extension
 * storage is keyed per id, so the token has to be entered once after moving.
 */
const UNPACKED_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo+Hc4ufIAeYAvduHhm+bhvLJDSWVSXmQke+pHNYY3C1bUGN26qHPqtHGSEZVx3sdUJuWo0qXDQcPeIWDvWcGPvL9z9vNxIOyGSDTZIQs1FuDHsVlbh77ebNInrO6zXtfhlqQc6383pspwf9Z7624OCe3Q5JMIwNXF9LhSsvny6eb19SYzAlo+1zFgwfJg9IBYOY/cMKW7vL2qSBvHf5a0x4kAEXne9pTJnc5zrjDABXKbedRqymP4ukqsOFN/gRg+OgyK1sPzw9yjjAJFW4xn/xbY7RZL3cD6xRyqFjJv4Go6k8ptRGxODmV/eORTfkl4f4G8lrA3qYua8EH1H19jwIDAQAB';

/**
 * The add-on's identity on Firefox, which has no equivalent of the `key` above.
 *
 * Firefox needs an explicit id to sign an add-on and to match an update
 * manifest against it, and the id is the add-on's identity forever: changing it
 * makes an existing install a different add-on that no longer updates. The
 * namespace is one this project actually controls rather than a domain it does
 * not.
 */
const GECKO_ID = 'a-better-reviewer@justinmwarner.github.io';

/**
 * Set by `scripts/store-build.mjs`, never by hand.
 *
 * An environment variable rather than `--mode store`, because Vite derives
 * `isProduction` from `mode === 'production'` and a custom mode therefore
 * builds React's development runtime into the package. See that script.
 */
const forStore = process.env.CWS_BUILD === '1';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // A separate directory, so a store build never silently becomes the thing
  // `test:e2e` loads or the thing someone has loaded unpacked.
  outDir: forStore ? '.output/store' : '.output',
  manifest: ({ browser: target }) => ({
    name: 'A Better Reviewer',
    description: 'A fast review UI for GitHub pull requests.',
    // Chromium only. `key` is not a Firefox manifest property, and AMO's
    // linter reports unknown properties on submission.
    ...(forStore || target === 'firefox' ? {} : { key: UNPACKED_KEY }),
    // 115 is where `storage.session` landed, and the vault keeps the decrypted
    // token there. An older Firefox would fail to unlock rather than degrade.
    //
    // `web-ext lint` reports two KEY_FIREFOX_*_UNSUPPORTED_BY_MIN_VERSION
    // warnings against this floor, because `data_collection_permissions` below
    // needs Firefox 140. They are expected. Raising the floor to 140 would
    // silence them by dropping every Firefox between 115 and 139, which is a
    // worse trade than two informational warnings — the key is ignored on
    // older versions, not broken by them.
    ...(target === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: GECKO_ID,
              strict_min_version: '115.0',
              /**
               * Required of new add-ons since 3 November 2025, and `none` is
               * the accurate answer: the extension transmits nothing to its
               * developer or to any third party. It sends the user's own token
               * to GitHub, which is the service the user is authenticating to
               * and the extension's entire purpose — not collection. This
               * matches the Chrome Web Store disclosures.
               */
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
    // `tabs` is deliberately absent. The only tabs call is
    // `tabs.update(tabId, { url })`, and navigation needs no permission —
    // `tabs` is required only to read a tab's url, title or favIconUrl, none
    // of which this extension does.
    permissions: ['storage'],
    host_permissions: ['https://github.com/*', 'https://api.github.com/*'],
  }),
});
