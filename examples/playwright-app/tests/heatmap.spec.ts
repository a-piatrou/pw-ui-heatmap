import { test, expect } from 'pw-ui-heatmap';

test('login flow exercises email and submit, misses signup link', async ({
  page,
  heatmap,
}) => {
  await page.goto('/login');
  await heatmap.page('LoginPage');
  await page.getByLabel('Email').fill('demo@test.local');
  await page.getByLabel('Password').fill('hunter2');
  await page.getByLabel('Remember me').check();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
});

test('users list — open user 42', async ({ page }) => {
  await page.goto('/users');
  await page.getByRole('link', { name: /Alice Adams/ }).click();
  await expect(page.getByRole('heading', { name: 'User Detail' })).toBeVisible();
});

test('user detail — visibility checks only', async ({ page, heatmap }) => {
  await page.goto('/users/42');
  await heatmap.page('UserDetailPage');
  await expect(page.getByRole('heading', { name: 'User Detail' })).toBeVisible();
  await expect(page.getByText('alice@demo.test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
});
