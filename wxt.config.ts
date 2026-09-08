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

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // `--mode store` rather than an env var, so the store build works the same
  // from PowerShell, cmd and a POSIX shell without a cross-env dependency.
  manifest: ({ mode }) => ({
    name: 'A Better Reviewer',
    description: 'A fast review UI for GitHub pull requests.',
    ...(mode === 'store' ? {} : { key: UNPACKED_KEY }),
    // `tabs` is deliberately absent. The only tabs call is
    // `tabs.update(tabId, { url })`, and navigation needs no permission —
    // `tabs` is required only to read a tab's url, title or favIconUrl, none
    // of which this extension does.
    permissions: ['storage'],
    host_permissions: ['https://github.com/*', 'https://api.github.com/*'],
  }),
});
