import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('admin123');
  const meResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/me') && response.request().method() === 'GET',
    { timeout: 15_000 },
  );
  const menusResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/system/menus/async') && response.request().method() === 'GET',
    { timeout: 15_000 },
  );
  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await page.getByRole('button', { name: '登 录' }).click();
  const loginResponse = await loginResponsePromise;
  const [meResponse, menusResponse] = await Promise.all([meResponsePromise, menusResponsePromise]);
  expect(loginResponse.headers()['cache-control']).toBe('no-store, no-transform');
  expect(loginResponse.headers().pragma).toBe('no-cache');
  expect(meResponse.status()).toBe(200);
  expect(meResponse.headers()['cache-control']).toBe('no-store, no-transform');
  expect(meResponse.headers().pragma).toBe('no-cache');
  expect(menusResponse.status()).toBe(200);
  expect(menusResponse.headers()['cache-control']).toBe('no-store, no-transform');
  expect(menusResponse.headers().pragma).toBe('no-cache');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('欢迎回来', {
    timeout: 15_000,
  });
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const pageTransition = page.locator('.gvaPageTransition');
  if (await pageTransition.count()) {
    await expect(pageTransition).not.toHaveClass(/\bis-enter\b/, { timeout: 5_000 });
  }

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const violations = results.violations.filter(
    ({ impact }) => impact === 'critical' || impact === 'serious',
  );
  const details = violations
    .flatMap(({ id, impact, help, nodes }) => [
      `${impact}: ${id} (${nodes.length}) ${help}`,
      ...nodes.map(({ target, failureSummary }) =>
        `  ${target.join(' > ')}: ${failureSummary?.replace(/\s+/g, ' ') ?? 'failed'}`,
      ),
    ])
    .join('\n');

  expect(violations, details || 'No serious accessibility violations').toEqual([]);
}

async function captureLayoutEvidence(page: Page, testInfo: TestInfo, name: string) {
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

test('redirects anonymous users and rejects invalid credentials', async ({ page }) => {
  const anonymousPageResponse = await page.request.get('/projects', { maxRedirects: 0 });
  expect(anonymousPageResponse.status()).toBe(307);
  expect(anonymousPageResponse.headers()['location']).toContain('/login?redirect=%2Fprojects');
  expect(anonymousPageResponse.headers()['cache-control']).toBe('no-store, no-transform');
  expect(anonymousPageResponse.headers().pragma).toBe('no-cache');

  const anonymousMeResponse = await page.request.get('/api/auth/me');
  expect(anonymousMeResponse.status()).toBe(401);
  expect(anonymousMeResponse.headers()['cache-control']).toBe('no-store, no-transform');
  expect(anonymousMeResponse.headers().pragma).toBe('no-cache');

  const crossOriginResponse = await page.request.post('/api/auth/login', {
    data: { username: 'admin', password: 'admin123' },
    headers: { origin: 'https://attacker.example' },
  });
  expect(crossOriginResponse.status()).toBe(403);
  expect(crossOriginResponse.headers()['cache-control']).toBe('no-store, no-transform');
  expect(crossOriginResponse.headers().pragma).toBe('no-cache');

  const loginPageResponse = await page.goto('/login');
  expect(loginPageResponse?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(loginPageResponse?.headers()['cross-origin-opener-policy']).toBe('same-origin');
  expect(loginPageResponse?.headers()['cross-origin-resource-policy']).toBe('same-origin');
  expect(loginPageResponse?.headers()['permissions-policy']).toContain('camera=()');
  expect(loginPageResponse?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(loginPageResponse?.headers()['x-content-type-options']).toBe('nosniff');
  expect(loginPageResponse?.headers()['x-frame-options']).toBe('DENY');

  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login\?redirect=%2Fprojects$/);

  await page.getByLabel('密码', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: '登 录' }).click();

  await expect(
    page.getByRole('alert').filter({ hasText: '用户名或密码错误' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login\?redirect=%2Fprojects$/);
});

test('logs in, logs out, and invalidates the protected session', async ({ page }) => {
  await login(page);

  const sessionCookie = (await page.context().cookies()).find(
    ({ name }) => name === 'msfront_token',
  );
  expect(sessionCookie).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  });

  const meResponse = await page.request.get('/api/auth/me');
  expect(meResponse.status()).toBe(200);
  expect(meResponse.headers()['cache-control']).toBe('no-store, no-transform');
  expect(meResponse.headers().pragma).toBe('no-cache');

  const authenticatedLoginResponse = await page.request.get('/login', { maxRedirects: 0 });
  expect(authenticatedLoginResponse.status()).toBe(307);
  expect(authenticatedLoginResponse.headers()['location']).toMatch(/\/dashboard$/);
  expect(authenticatedLoginResponse.headers()['cache-control']).toBe('no-store, no-transform');
  expect(authenticatedLoginResponse.headers().pragma).toBe('no-cache');

  const logoutResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/logout') && response.request().method() === 'POST',
  );
  await page
    .getByRole('banner')
    .getByRole('button', { name: '超级管理员', exact: true })
    .click();
  await page.getByRole('menu').getByRole('button', { name: '登 出' }).click();
  const logoutResponse = await logoutResponsePromise;
  expect(logoutResponse.headers()['cache-control']).toBe('no-store, no-transform');
  expect(logoutResponse.headers().pragma).toBe('no-cache');
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/);
});

test('renders the not-found state and recovers to the dashboard', async ({ page }) => {
  await login(page);
  await page.goto('/missing-e2e-route');
  await expect(page.getByRole('heading', { level: 1, name: '页面不存在' })).toBeVisible();

  await page.getByRole('link', { name: '返回控制台' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('meets the serious WCAG gate on login and dashboard', async ({ page }, testInfo) => {
  await page.goto('/login');
  await expectNoSeriousAccessibilityViolations(page);
  await captureLayoutEvidence(page, testInfo, 'login');

  await login(page);
  await expectNoSeriousAccessibilityViolations(page);
  await captureLayoutEvidence(page, testInfo, 'dashboard');
});
