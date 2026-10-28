import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage();
  const svg = readFileSync('apps/web/public/icons/crest.svg', 'utf8');
  mkdirSync('apps/web/public/icons', { recursive: true });
  for (const [size, file] of [
    [32, 'icon-32.png'],
    [192, 'icon-192.png'],
    [180, 'apple-touch-icon.png'],
  ] as const) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%}svg{width:100%;height:100%}</style>${svg}`,
    );
    await page.screenshot({ path: 'apps/web/public/icons/' + file, omitBackground: true });
  }
} finally {
  await browser.close();
}
