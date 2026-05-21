# pw-ui-heatmap

> Post-run UI coverage heatmap for Playwright tests. Drop it into your project, run your test suite, get a static HTML report showing every page your tests visited — with a counter badge and a colored outline on every element your tests interacted with.

- **Red outline** — element exists on the page but no test touched it
- **Orange outline** — 1 or 2 interactions
- **Green outline** — 3 or more interactions
- **Badge** — total interaction count
- **Tooltip** — per-action breakdown (`click: 2`, `assert.visible: 1`, …) and the tests that touched the element

Works with any web app (React, Vue, Svelte, plain HTML — it doesn't care). Test framework: **Playwright only**.

## Install

```bash
npm i -D pw-ui-heatmap
```

`@playwright/test` is a peer dependency.

## Setup (two lines)

In `playwright.config.ts`, add the reporter:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['pw-ui-heatmap/reporter', { outputDir: './heatmap-report' }],
  ],
});
```

In your test files, swap the Playwright import for `pw-ui-heatmap`:

```ts
import { test, expect } from 'pw-ui-heatmap';

test('login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('a@b.c');
  await page.getByRole('button', { name: 'Sign in' }).click();
});
```

That's it. Run `npx playwright test` and the report will be written to `./heatmap-report/`. Open it with:

```bash
npx pw-ui-heatmap serve ./heatmap-report
```

## The `heatmap` fixture (optional)

Each test receives an extra `heatmap` fixture:

```ts
test('detail', async ({ page, heatmap }) => {
  await page.goto('/users/42');
  await heatmap.page('UserDetailPage');     // override auto-derived page name
  heatmap.mask('.credit-card-number');      // mask sensitive content in snapshots
  await heatmap.snapshot();                 // force-capture a snapshot now
});
```

### `heatmap.page(name: string)`
Tags the current page with an explicit name. By default the package auto-derives a name from the URL (with parameter templating: `/users/42` → `/users/:id`). Use `heatmap.page(...)` when:

- You use Page Object Model and want POM names in the report (`LoginPage` instead of `/auth/login`).
- The auto-template doesn't fit (e.g. a slug-based route like `/posts/hello-world` would otherwise read as `/posts/hello-world`, not `/posts/:slug`).

Pages with the same explicit name are merged in the report (one row, summed interactions).

### `heatmap.mask(selector: string)`
Adds a CSS selector whose `value` / `textContent` is replaced with bullets in the captured snapshot. Useful for PII and sensitive data. **`input[type="password"]` is masked by default**.

### `heatmap.snapshot()`
Force-captures a snapshot of the current page state. You rarely need this — snapshots are taken automatically on the first interaction with each page identity, and re-taken when significant DOM changes are detected.

## CLI

```text
pw-ui-heatmap serve [dir]       # serve a report on http://127.0.0.1:<port>/
  -p, --port <port>             # preferred port (default: auto)
  --host <host>                 # bind host (default: 127.0.0.1)
  --no-open                     # do not auto-open browser

pw-ui-heatmap merge <inputs...> # merge sharded CI reports into one
  -o, --output <dir>            # destination
```

## Reporter options

```ts
['pw-ui-heatmap/reporter', {
  outputDir: './heatmap-report',  // where the report is written
  tmpDir: undefined,              // override scratch dir (default: <outputDir>/.tmp)
  recordAssertions: true,         // record expect(locator).toBeVisible() etc.
  thresholds: { orange: 2 },      // counts <= this are orange; above are green
  identity: {
    includeQueryParams: false,    // include query string in URL templating
  },
}]
```

## How it works (high level)

1. The **fixture** wraps `page` and every `Locator` it creates. Before executing each action, it injects a stable `data-pwhm-id="<uuid>"` on the live DOM element. The interaction is recorded as `{ pageId, pwhmId, action, testTitle }`.
2. On the first interaction with a new "page identity" (auto-templated URL or explicit name + viewport bucket), a full snapshot is captured: the cloned HTML (with form state copied to attributes, password fields masked, accessible CSS inlined), a screenshot, and a list of *all* interactable candidate elements (buttons, links, inputs, …) — each tagged with `data-pwhm-candidate`.
3. The **Reporter** writes each worker's interactions to NDJSON during the run, then in `onEnd` it aggregates everything, computes coverage per page, and emits a static report.
4. The report's per-page view loads the snapshot HTML in a sandboxed iframe and uses JavaScript to draw badges + colored outlines aligned to elements by `data-pwhm-id` / `data-pwhm-candidate`.

## Limitations

- **Cross-origin iframes** in the app under test cannot be cloned. They appear blank in snapshots; counters still work for the parent frame.
- **Shadow DOM** isn't deep-walked in v1. Elements inside closed shadow roots won't appear in the snapshot.
- **Canvas / video** frames are not captured.
- **Stylesheets from cross-origin CDNs** cannot be inlined; the iframe's `<link>` may fail to load. The screenshot thumbnail on the index page still renders correctly.
- **Opening `index.html` from disk** with `file://` may be blocked by browser cross-origin policies. Use `npx pw-ui-heatmap serve` — it's a one-liner.

## License

MIT.
