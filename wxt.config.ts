import { defineConfig } from 'wxt';

export default defineConfig({
  // Chrome extension pages run in an isolated extension world. Vite's
  // modulepreload links are either rejected as cross-world resources or are
  // reported as unused before PDF.js needs them, while normal module imports
  // already load the chunks correctly.
  vite: () => ({
    build: {
      modulePreload: false,
      rolldownOptions: {
        output: {
          // Production packages must not retain diagnostics that can expose
          // PDF text, prompts, model responses, or API endpoint details.
          minify: {
            compress: {
              dropConsole: true,
              dropDebugger: true,
            },
            mangle: true,
            codegen: true,
          },
        },
      },
    },
  }),
  manifest: {
    name: 'PDFPal',
    version: '1.0.0',
    description: 'PDFPal AI PDF 阅读器，支持翻译、批注、记忆和智能问答。',
    icons: {
      16: 'resources/pdfpal/icon-16.png',
      32: 'resources/pdfpal/icon-32.png',
      48: 'resources/pdfpal/icon-48.png',
      128: 'resources/pdfpal/icon-128.png',
    },
    permissions: ['tabs', 'storage', 'contextMenus'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '打开 PDFPal 阅读器',
      default_icon: {
        16: 'resources/pdfpal/icon-16.png',
        32: 'resources/pdfpal/icon-32.png',
        48: 'resources/pdfpal/icon-48.png',
        128: 'resources/pdfpal/icon-128.png',
      },
    },
  },
});
