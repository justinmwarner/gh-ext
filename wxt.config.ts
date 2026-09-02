import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Fast GitHub Review',
    description: 'A fast review UI for GitHub pull requests.',
    // Pins the extension id to kpjeagilmchpoganlnllmhloplapcnoj on every
    // machine. Without it Chrome derives a fresh id per unpacked install, so
    // the same extension looks like a different one on each computer.
    //
    // This is the *public* half of the pair and is safe in a public repo — it
    // is what Chrome hashes to get the id. The private key is only needed to
    // pack a .crx, which this project does not do, so it was never committed.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo+Hc4ufIAeYAvduHhm+bhvLJDSWVSXmQke+pHNYY3C1bUGN26qHPqtHGSEZVx3sdUJuWo0qXDQcPeIWDvWcGPvL9z9vNxIOyGSDTZIQs1FuDHsVlbh77ebNInrO6zXtfhlqQc6383pspwf9Z7624OCe3Q5JMIwNXF9LhSsvny6eb19SYzAlo+1zFgwfJg9IBYOY/cMKW7vL2qSBvHf5a0x4kAEXne9pTJnc5zrjDABXKbedRqymP4ukqsOFN/gRg+OgyK1sPzw9yjjAJFW4xn/xbY7RZL3cD6xRyqFjJv4Go6k8ptRGxODmV/eORTfkl4f4G8lrA3qYua8EH1H19jwIDAQAB',
    permissions: ['storage', 'tabs'],
    host_permissions: ['https://github.com/*', 'https://api.github.com/*'],
  },
});
