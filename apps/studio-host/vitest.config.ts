import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const upstreamSrc = resolve(__dirname, '../../third_party/rhwp/rhwp-studio/src');
const hopSrc = resolve(__dirname, 'src');

const hopOverride = (id: string) => ({
  find: `@/${id}`,
  replacement: resolve(hopSrc, id),
});

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: [
      hopOverride('core/font-loader'),
      hopOverride('core/bridge-factory'),
      hopOverride('core/document-files'),
      hopOverride('core/desktop-events'),
      hopOverride('core/tauri-bridge'),
      hopOverride('command/shortcut-map'),
      hopOverride('command/commands/file'),
      hopOverride('ui/custom-select'),
      hopOverride('ui/dialog'),
      hopOverride('ui/print-dialog'),
      hopOverride('ui/toolbar'),
      hopOverride('styles/custom-select.css'),
      hopOverride('styles/font-set-dialog.css'),
      { find: '@upstream', replacement: upstreamSrc },
      { find: '@', replacement: upstreamSrc },
    ],
  },
});
