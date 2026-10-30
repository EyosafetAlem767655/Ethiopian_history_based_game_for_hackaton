import { test, expect } from '@playwright/test';
test('reads a synthetic birth date with local OCR and submits only after consent', async ({
  page,
}) => {
  // Mock only the hosted account/storage endpoints. No real identity document or external account is used.
  await page.route('**/api/me', async (route) => {
    const response = await route.fetch();
    const me = await response.json();
    await route.fulfill({ json: { ...me, identity: 'supabase' } });
  });
  let pending = false;
  let submitted: any = null;
  let evidence = false;
  await page.route('**/api/age-review', async (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { id: 'synthetic-review', expires: Date.now() + 86400000 } });
    } else
      await route.fulfill({
        json: {
          enabled: true,
          status: pending ? 'pending' : 'unsubmitted',
          band: null,
          label: 'Synthetic review fixture',
        },
      });
  });
  await page.route('**/api/age-review/synthetic-review/evidence', async (route) => {
    evidence = route.request().headers()['x-document-consent'] === 'true';
    pending = true;
    await route.fulfill({ json: { status: 'pending' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'ENTER THE KINGDOM' }).click();
  await page.getByLabel('WARRIOR NAME').fill('OCR Fixture');
  await page.getByRole('button', { name: 'BEGIN NORMAL PROGRESSION' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your warrior.' })).toBeVisible();
  await page.getByRole('button', { name: 'Verify identity' }).click();
  const input = page.locator('input[type=file]');
  await expect(input).toBeDisabled();
  await page.getByRole('checkbox').check();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 420;
    const g = c.getContext('2d')!;
    g.fillStyle = 'white';
    g.fillRect(0, 0, 1200, 420);
    g.fillStyle = 'black';
    g.font = '46px Arial';
    g.fillText('SYNTHETIC TEST ONLY', 40, 90);
    g.fillText('Date of Birth: 1999-04-03', 40, 210);
    return c.toDataURL('image/png').split(',')[1];
  });
  await input.setInputFiles({
    name: 'synthetic-birth.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.getByLabel('Birth year')).toHaveValue('1999', { timeout: 90000 });
  await expect(page.getByLabel('Birth month')).toHaveValue('4');
  await expect(page.getByLabel('Birth day')).toHaveValue('3');
  expect(submitted).toBeNull();
  expect(evidence).toBe(false);
  await page.getByRole('button', { name: 'Submit for manual review' }).click();
  await expect(page.getByRole('status')).toContainText('Submitted for manual review');
  expect(submitted).toMatchObject({
    document: 'fayda',
    consent: true,
    birth: { year: 1999, month: 4, day: 3, calendar: 'gregorian' },
  });
  expect(evidence).toBe(true);
  await expect(page.getByText('Status: pending')).toBeVisible();
});
test('stops camera tracks after capture and keeps the selfie off the network', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__cameraStops = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 240;
        const g = c.getContext('2d')!;
        g.fillStyle = '#a77b53';
        g.fillRect(0, 0, 320, 240);
        const stream = c.captureStream(10);
        for (const t of stream.getTracks()) {
          const stop = t.stop.bind(t);
          t.stop = () => {
            (window as any).__cameraStops++;
            stop();
          };
        }
        return stream;
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'ENTER THE KINGDOM' }).click();
  await page.getByLabel('WARRIOR NAME').fill('Private Camera');
  await page.getByRole('button', { name: 'PLAY THE STORY DEMO' }).click();
  await page.getByRole('button', { name: 'Your likeness' }).click();
  const outgoing: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' || req.method() === 'PUT') outgoing.push(req.url());
  });
  await page.getByRole('button', { name: 'Use camera (optional)' }).click();
  await expect(page.locator('video')).toBeVisible();
  await page.getByRole('button', { name: 'Capture and suggest' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__cameraStops)).toBeGreaterThan(0);
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save avatar' })).toBeEnabled({ timeout: 55000 });
  expect(outgoing).toEqual([]);
  await page.getByRole('button', { name: 'Save avatar' }).click();
  await expect(page.getByRole('status')).toContainText('Avatar saved');
  await expect(page.locator('.selfie-preview')).toHaveCount(0);
  expect(outgoing).toHaveLength(1);
  expect(outgoing[0]).toMatch(/\/api\/avatar$/);
});
test('persists editable avatars, offers manual camera fallback and explains private age access', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'ENTER THE KINGDOM' }).click();
  await page.getByLabel('WARRIOR NAME').fill('Avatar Knight');
  await page.getByRole('button', { name: 'PLAY THE STORY DEMO' }).click();
  await page.getByRole('button', { name: 'Your likeness' }).click();
  await expect(page.locator('.avatar-preview canvas')).toBeVisible();
  await page.getByLabel('Avatar shape').selectOption('square');
  await page.getByLabel('Avatar hair').selectOption('braids');
  await page.getByLabel('Avatar beard').selectOption('none');
  await page.getByRole('button', { name: 'Save avatar' }).click();
  await expect(page.getByRole('status')).toContainText('Avatar saved');
  const saved = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('knights-session')!);
    return (
      await fetch('http://localhost:2570/api/me', {
        headers: { Authorization: 'Bearer ' + s.token },
      })
    ).json();
  });
  expect(saved.avatar.shape).toBe('square');
  expect(saved.avatar.hair).toBe('braids');
  expect(saved.avatar).not.toHaveProperty('selfie');
  await page.screenshot({ path: 'output/playwright/avatar-editor.png' });
  await page.reload();
  await page.getByRole('button', { name: 'Your likeness' }).click();
  await expect(page.getByLabel('Avatar hair')).toHaveValue('braids');
  await page.getByRole('button', { name: 'Verify identity' }).click();
  await expect(page.getByRole('heading', { name: 'Verify your identity' })).toBeVisible();
  // The panel always asks for the Fayda ID; sending it waits for sign-in and reviewer setup.
  await expect(page.getByRole('button', { name: 'Scan ID with camera' })).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Your legacy' }).click();
  await page.getByRole('slider', { name: 'Menu music volume' }).fill('0.15');
  expect(await page.evaluate(() => localStorage.getItem('kibre-music-volume'))).toBe('0.15');
  expect(errors).toEqual([]);
});
