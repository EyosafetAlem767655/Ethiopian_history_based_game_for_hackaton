import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

test('links a synthetic wallet, simulates profile and badge claims, and revokes logout', async ({
  page,
}) => {
  const account = privateKeyToAccount(generatePrivateKey());
  const session = JSON.parse(readFileSync('output/tests/browser-fixtures.json', 'utf8')).web3;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.exposeFunction('signSyntheticWalletMessage', (raw: Hex) =>
    account.signMessage({ message: { raw } }),
  );
  await page.addInitScript(
    ({ credential, address }) => {
      // Synthetic provider only: the real backend still verifies the actual signature.
      if (!sessionStorage.getItem('fixture-installed')) {
        localStorage.setItem('knights-session', JSON.stringify(credential));
        sessionStorage.setItem('fixture-installed', 'true');
      }
      (window as any).ethereum = {
        request: async ({ method, params }: { method: string; params: string[] }) => {
          if (method === 'eth_requestAccounts') return [address];
          if (method === 'personal_sign')
            return (window as any).signSyntheticWalletMessage(params[0]);
          throw Error('Unexpected synthetic wallet method: ' + method);
        },
      };
    },
    { credential: session, address: account.address },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Your legacy' }).click();
  await page.getByRole('button', { name: 'LINK YOUR WALLET', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Blockchain profile and rewards' });
  await expect(panel).toContainText('no blockchain transactions or tokens are created');
  await panel.getByRole('button', { name: 'SIMULATE PROFILE REGISTRATION' }).click();
  await expect(panel).toContainText('Profile registration: SIMULATED');
  await panel.getByRole('button', { name: 'SIMULATE TOKEN CLAIM' }).click();
  await expect(panel).toContainText('SIMULATED · Token type 1');
  await page.screenshot({ path: 'output/playwright/web3-profile.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'CHANGE IDENTITY / SIGN OUT' }).click();
  await expect(page.getByLabel('WARRIOR NAME')).toBeVisible();
  expect(
    (
      await page.request.get('http://localhost:2570/api/me', {
        headers: { Authorization: 'Bearer ' + session.token },
      })
    ).status(),
  ).toBe(401);
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('knights-session'))).toBeNull();
  expect(errors).toEqual([]);
});
