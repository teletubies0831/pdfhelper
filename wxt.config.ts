import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'PDF Read Helper',
    description: '为 PDF 阅读提供划词、翻译、知识卡片和 AI 助手。',
    permissions: ['tabs', 'storage', 'contextMenus', 'sidePanel'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '打开 PDF Helper 侧边栏',
    },
  },
});
