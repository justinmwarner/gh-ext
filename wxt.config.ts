import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Fast GitHub Review',
    description: 'A fast review UI for GitHub pull requests.',
    permissions: ['storage', 'tabs'],
    host_permissions: ['https://github.com/*', 'https://api.github.com/*'],
  },
});
