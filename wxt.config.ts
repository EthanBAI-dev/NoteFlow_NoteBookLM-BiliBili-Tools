import { defineConfig } from 'wxt';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version as string;
const gitHash = execSync('git rev-parse --short HEAD').toString().trim();
const buildTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: process.env.WXT_OUT_DIR || (process.env.NODE_ENV === 'development' || process.argv.includes('dev') ? 'dist-dev' : 'dist'),

  dev: {
    server: {
      port: 3003,
      hostname: 'localhost',
    },
  },

  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    version,
    version_name: `${version}+${gitHash}`,
    permissions: [
      'storage',
      'activeTab',
      'tabs',
      'scripting',
      'contextMenus',
      'downloads',
      'offscreen',
      'identity',
      'sidePanel',
      'webRequest',
      'webNavigation',
    ],
    host_permissions: [
      'https://notebooklm.google.com/*',
      'https://claude.ai/*',
      'https://platform.claude.com/*',
      'https://www.youtube.com/*',
      'https://api.bilibili.com/*',
      'https://www.bilibili.com/*',
      'https://i.hdslb.com/*',
      'https://www.googleapis.com/*',
      'https://accounts.google.com/*',
    ],
    // oauth2 is removed for now; will be re-added when Google Drive upload is ready
    side_panel: {
      default_path: 'sidepanel.html',
    },
    icons: {
      '16': 'icons/icon-16.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },

  vite: ({ mode }) => ({
    define: {
      'process.env': '{}',
      'process.env.NODE_ENV': mode === 'development' ? '"development"' : '"production"',
      __GIT_HASH__: JSON.stringify(gitHash),
      __BUILD_TIME__: JSON.stringify(buildTime),
      __VERSION__: JSON.stringify(version),
    },
    build: {
      modulePreload: false,
      sourcemap: false,
    },
    plugins: [
      {
        // Strip remote CDN URLs from jspdf to comply with MV3 no-remote-code policy
        name: 'strip-remote-code-urls',
        transform(code: string, id: string) {
          if (id.includes('jspdf')) {
            return code.replace(
              /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdfobject\/[^"']*/g,
              '',
            );
          }
        },
      },
    ],
  }),
});
