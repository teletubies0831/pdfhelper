import { defineConfig } from 'wxt';

export default defineConfig({
  // Chrome extension pages run in an isolated extension world. Vite's
  // modulepreload links are either rejected as cross-world resources or are
  // reported as unused before PDF.js needs them, while normal module imports
  // already load the chunks correctly.
  vite: () => ({
    build: {
      modulePreload: false,
    },
  }),
  manifest: {
    name: 'PDF Read Helper',
    description: 'PDF Helper 增强阅读器，支持 PDF 阅读、批注、记忆和 AI 阅读助手。',
    permissions: ['tabs', 'storage', 'contextMenus'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '打开 PDF Helper 阅读器',
    },
  },
});
