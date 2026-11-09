import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * e2e 配置。
 *
 * 沙箱/内网机器上通常已经装了系统 Chromium，直接复用比下载 Playwright 自带浏览器快得多；
 * CI 里没有系统浏览器，就交给 `playwright install chromium` 装的那一份。
 */
const systemChrome = process.env.CHROME_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : '')

export default defineConfig({
  testDir: './e2e',
  // 只认 *.e2e.ts，避免被 vitest 的默认 include 一起收走
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
    launchOptions: systemChrome ? { executablePath: systemChrome } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // 显式绑 IPv4：默认只听 localhost(::1)，而 baseURL 写的是 127.0.0.1
    command: 'npx vite --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
