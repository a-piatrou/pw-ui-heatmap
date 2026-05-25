import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [
    ['list'],
    ['pw-ui-heatmap/reporter', { outputDir: './heatmap-report' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3737',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'node serve.mjs',
    url: 'http://127.0.0.1:3737/',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
