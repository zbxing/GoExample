import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('admin123');
  await page.getByRole('button', { name: '登 录' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('欢迎回来');
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
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
  const crossOriginResponse = await page.request.post('/api/auth/login', {
    data: { username: 'admin', password: 'admin123' },
    headers: { origin: 'https://attacker.example' },
  });
  expect(crossOriginResponse.status()).toBe(403);

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

  await page
    .getByRole('banner')
    .getByRole('button', { name: '超级管理员', exact: true })
    .click();
  await page.getByRole('menu').getByRole('button', { name: '登 出' }).click();
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
