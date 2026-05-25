// Direct verification of the generated report (no Playwright test runner).
// Requires the serve CLI to be running on port 4747.

import { chromium } from 'playwright';

const URL = process.env.REPORT_URL ?? 'http://127.0.0.1:4747';

const assertions = [];
function assert(cond, msg) {
  assertions.push({ ok: !!cond, msg });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', (msg) => console.log('[browser]', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('[pageerror]', err.message));
try {
  // Index page.
  await page.goto(URL + '/');
  const title = await page.locator('h1').first().textContent();
  assert(title?.includes('UI Coverage Heatmap'), 'index page title');

  const cards = page.locator('.page-card');
  const cardCount = await cards.count();
  assert(cardCount === 4, `index has 4 page cards (got ${cardCount})`);

  // Capture index screenshot.
  await page.screenshot({ path: 'verify-index.png', fullPage: false });

  // Find LoginPage card.
  const loginCard = page.locator('.page-card__title', { hasText: 'LoginPage' });
  assert(await loginCard.count() === 1, 'LoginPage card exists');

  // Open page view by clicking the card containing LoginPage.
  await loginCard.locator('xpath=ancestor::a').click();
  await page.waitForLoadState('domcontentloaded');

  // Verify page-shell loaded.
  const pageTitle = await page.locator('#page-title').textContent();
  assert(pageTitle === 'LoginPage', `page-title is LoginPage (got "${pageTitle}")`);

  // Wait for overlay to actually draw boxes (iframe load + JS init is racy).
  const overlayBoxes = page.locator('.pwhm-box');
  const boxCount = await overlayBoxes.first().waitFor({ state: 'attached', timeout: 5000 })
    .then(() => overlayBoxes.count())
    .catch(() => 0);
  assert(boxCount > 0, `LoginPage has overlay boxes (got ${boxCount})`);

  const counts = await overlayBoxes.evaluateAll((els) =>
    els.map((el) => {
      const text = el.querySelector('.pwhm-badge')?.textContent ?? '0';
      return Number(text.trim());
    }),
  );
  const touched = counts.filter((n) => n > 0).length;
  const untouched = counts.filter((n) => n === 0).length;
  assert(touched >= 4, `LoginPage has >=4 touched badges (got ${touched})`);
  assert(untouched >= 2, `LoginPage has >=2 untouched (red) badges (got ${untouched})`);

  // Check class names contain the right color
  const colors = await overlayBoxes.evaluateAll((els) =>
    els.map((el) => el.className.split(/\s+/).find((c) => c.startsWith('pwhm-') && c !== 'pwhm-box' && c !== 'pwhm-badge')),
  );
  assert(colors.includes('pwhm-red'), 'has red outline');
  assert(colors.includes('pwhm-orange') || colors.includes('pwhm-green'), 'has orange or green outline');

  // Screenshot for the human.
  await page.screenshot({ path: 'verify-report.png', fullPage: true });
  console.log('saved screenshot to verify-report.png');
} finally {
  await browser.close();
}

const failed = assertions.filter((a) => !a.ok);
if (failed.length) {
  console.log(`\n${failed.length} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll verifications passed.');
