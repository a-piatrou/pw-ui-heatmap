import {
  test as baseTest,
  expect as baseExpect,
  type Locator,
  type Page,
  type TestInfo,
  type Expect,
} from '@playwright/test';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { autoIdentity, explicitIdentity } from './identity.js';
import { capturePageSnapshot, dirtyTrackerInitScript } from './snapshot.js';
import type {
  ActionKind,
  Interaction,
  PageIdentity,
  PageSnapshotMeta,
} from './types.js';

export const PWHM_TMP_ENV = 'PW_HEATMAP_TMP';

export interface HeatmapAPI {
  /** Tag the current page with an explicit, stable name (overrides URL templating). */
  page(name: string): Promise<void>;
  /** Add a CSS selector whose value/textContent is masked in snapshots. */
  mask(selector: string): void;
  /** Force-capture a snapshot of the current page right now (rarely needed). */
  snapshot(): Promise<void>;
}

interface HeatmapContext {
  testInfo: TestInfo;
  page: Page;
  interactions: Interaction[];
  capturedIdentities: Set<string>;
  identityOverride: string | null;
  masks: string[];
}

const ctxByLocator = new WeakMap<object, HeatmapContext>();
const ctxByPage = new WeakMap<object, HeatmapContext>();

const ACTION_METHODS = new Set<string>([
  'click',
  'dblclick',
  'tap',
  'hover',
  'fill',
  'type',
  'pressSequentially',
  'press',
  'check',
  'uncheck',
  'selectOption',
  'setInputFiles',
  'dragTo',
  'focus',
  'blur',
  'clear',
  'scrollIntoViewIfNeeded',
]);

const LOCATOR_BUILDER_METHODS = new Set<string>([
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByTestId',
  'getByAltText',
  'getByTitle',
  'first',
  'last',
  'nth',
  'filter',
  'and',
  'or',
  'frameLocator',
  'contentFrame',
]);

const ASSERTION_TO_ACTION: Record<string, ActionKind> = {
  toBeVisible: 'assert.visible',
  toBeHidden: 'assert.hidden',
  toBeEnabled: 'assert.enabled',
  toBeDisabled: 'assert.disabled',
  toBeChecked: 'assert.checked',
  toHaveText: 'assert.text',
  toContainText: 'assert.text',
  toHaveValue: 'assert.value',
  toHaveAttribute: 'assert.attribute',
  toHaveCount: 'assert.count',
  toBeEditable: 'assert.editable',
  toHaveClass: 'assert.attribute',
  toHaveId: 'assert.attribute',
};

const PWHM_CTX_SYMBOL = Symbol.for('pwhm.ctx');

async function ensureLocatorId(locator: Locator): Promise<string | null> {
  try {
    return await locator.evaluate((el: Element) => {
      let id = el.getAttribute('data-pwhm-id') ?? el.getAttribute('data-pwhm-candidate');
      if (!id) {
        // Stable id derived from the element's DOM path. Must mirror the
        // algorithm in snapshot.ts so ids match across parallel workers.
        const parts: string[] = [];
        let cur: Element | null = el;
        while (cur && cur !== document.documentElement) {
          const parent: Element | null = cur.parentElement;
          if (!parent) break;
          const tag = cur.tagName;
          let idx = 1;
          let sib: Element | null = cur.previousElementSibling;
          while (sib) {
            if (sib.tagName === tag) idx++;
            sib = sib.previousElementSibling;
          }
          parts.unshift(tag + '[' + idx + ']');
          cur = parent;
        }
        parts.unshift('HTML');
        const path = parts.join('>');
        let h = 5381;
        for (let i = 0; i < path.length; i++) h = ((h * 33) ^ path.charCodeAt(i)) >>> 0;
        id = 'p_' + h.toString(36);
      }
      el.setAttribute('data-pwhm-id', id);
      return id;
    });
  } catch {
    return null;
  }
}

async function ensureSnapshot(ctx: HeatmapContext): Promise<PageIdentity | null> {
  const viewport = ctx.page.viewportSize() ?? { width: 1280, height: 720 };
  let url: string;
  try {
    url = ctx.page.url();
  } catch {
    return null;
  }
  if (!url || url === 'about:blank') return null;

  // Sticky override: persists across snapshots until the main frame navigates.
  const identity = ctx.identityOverride
    ? explicitIdentity(ctx.identityOverride, url, viewport)
    : autoIdentity(url, viewport);

  let isDirty = true;
  try {
    isDirty = await ctx.page.evaluate(
      () => (window as unknown as { __pwhmDirty?: boolean }).__pwhmDirty !== false,
    );
  } catch {
    isDirty = true;
  }

  const haveSnapshot = ctx.capturedIdentities.has(identity.id);
  if (haveSnapshot && !isDirty) return identity;

  const tmp = process.env[PWHM_TMP_ENV];
  if (!tmp) return identity;

  let snap;
  try {
    snap = await capturePageSnapshot(ctx.page, { maskSelector: ctx.masks.join(',') });
  } catch {
    return identity;
  }

  const dir = join(tmp, 'snapshots', identity.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'snapshot.html'), snap.html, 'utf8');

  try {
    const png = await ctx.page.screenshot({ fullPage: true });
    writeFileSync(join(dir, 'screenshot.png'), png);
  } catch {
    // headless flake, skip — overlay will render without thumbnail
  }

  const meta: PageSnapshotMeta = {
    pageId: identity.id,
    snapshotPath: `pages/${identity.id}/snapshot.html`,
    screenshotPath: `pages/${identity.id}/screenshot.png`,
    title: snap.title,
    candidates: snap.candidates,
    viewportPx: snap.viewportPx,
  };
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({ identity, meta }, null, 2),
    'utf8',
  );

  try {
    await ctx.page.evaluate(() => {
      const w = window as unknown as { __pwhmMarkClean?: () => void };
      w.__pwhmMarkClean?.();
    });
  } catch {
    // ignore
  }

  ctx.capturedIdentities.add(identity.id);
  return identity;
}

async function recordInteraction(
  ctx: HeatmapContext,
  pwhmId: string,
  action: ActionKind,
  selectorHint?: string,
) {
  const identity = await ensureSnapshot(ctx);
  if (!identity) return;
  ctx.interactions.push({
    pageId: identity.id,
    pwhmId,
    action,
    testTitle: ctx.testInfo.title,
    testId: ctx.testInfo.testId,
    ts: new Date().toISOString(),
    selectorHint,
  });
}

function wrapLocator(locator: Locator, ctx: HeatmapContext): Locator {
  const proxy = new Proxy(locator, {
    get(target, prop) {
      if (prop === PWHM_CTX_SYMBOL) return ctx;
      const key = typeof prop === 'string' ? prop : '';

      if (ACTION_METHODS.has(key)) {
        const orig = Reflect.get(target, prop, target);
        return async function pwhmAction(...args: unknown[]) {
          const id = await ensureLocatorId(target);
          if (id) {
            await recordInteraction(ctx, id, key as ActionKind);
          }
          return (orig as (...a: unknown[]) => unknown).apply(target, args);
        };
      }

      if (LOCATOR_BUILDER_METHODS.has(key)) {
        const orig = Reflect.get(target, prop, target);
        return function pwhmBuilder(...args: unknown[]) {
          const result = (orig as (...a: unknown[]) => unknown).apply(target, args);
          if (result && typeof result === 'object') {
            return wrapLocator(result as Locator, ctx);
          }
          return result;
        };
      }

      // Pass everything else through with `this` bound to the target so
      // Playwright's internals (`this._frame`, `this.constructor.name`, …) work.
      return Reflect.get(target, prop, target);
    },
  });
  ctxByLocator.set(proxy as unknown as object, ctx);
  return proxy;
}

function wrapPage(page: Page, ctx: HeatmapContext): Page {
  const proxy = new Proxy(page, {
    get(target, prop) {
      if (prop === PWHM_CTX_SYMBOL) return ctx;
      const key = typeof prop === 'string' ? prop : '';

      if (LOCATOR_BUILDER_METHODS.has(key)) {
        const orig = Reflect.get(target, prop, target);
        return function pwhmPageBuilder(...args: unknown[]) {
          const result = (orig as (...a: unknown[]) => unknown).apply(target, args);
          if (result && typeof result === 'object') {
            return wrapLocator(result as Locator, ctx);
          }
          return result;
        };
      }

      return Reflect.get(target, prop, target);
    },
  });
  ctxByPage.set(proxy as unknown as object, ctx);
  return proxy;
}

function getCtx(value: unknown): HeatmapContext | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const direct = (value as Record<symbol, unknown>)[PWHM_CTX_SYMBOL];
  if (direct) return direct as HeatmapContext;
  return ctxByLocator.get(value as object) ?? ctxByPage.get(value as object);
}

function wrapAssertions(
  assertions: object,
  locator: Locator,
  ctx: HeatmapContext,
): object {
  return new Proxy(assertions, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      const key = typeof prop === 'string' ? prop : '';

      if (key === 'not' && orig && typeof orig === 'object') {
        return wrapAssertions(orig as object, locator, ctx);
      }

      if (typeof orig === 'function' && ASSERTION_TO_ACTION[key]) {
        return async function pwhmAssertion(...args: unknown[]) {
          const id = await ensureLocatorId(locator);
          const result = await (orig as (...a: unknown[]) => unknown).apply(target, args);
          if (id) {
            await recordInteraction(ctx, id, ASSERTION_TO_ACTION[key]);
          }
          return result;
        };
      }

      return typeof orig === 'function'
        ? (orig as (...a: unknown[]) => unknown).bind(target)
        : orig;
    },
  });
}

function makeExpectProxy(orig: Expect): Expect {
  const wrap = (
    fn: (value: unknown, message?: string) => object,
    value: unknown,
    message?: string,
  ) => {
    const result = fn(value, message);
    const ctx = getCtx(value);
    if (ctx && value && typeof value === 'object') {
      return wrapAssertions(result, value as Locator, ctx);
    }
    return result;
  };

  const handler = ((value: unknown, message?: string) =>
    wrap(orig as unknown as (v: unknown, m?: string) => object, value, message)) as unknown as Expect;

  for (const key of Reflect.ownKeys(orig as unknown as object)) {
    const desc = Object.getOwnPropertyDescriptor(orig as unknown as object, key);
    if (!desc) continue;
    if (key === 'soft' && typeof (orig as unknown as { soft?: unknown }).soft === 'function') {
      (handler as unknown as { soft: unknown }).soft = (value: unknown, message?: string) =>
        wrap(
          (orig as unknown as { soft: (v: unknown, m?: string) => object }).soft,
          value,
          message,
        );
    } else {
      Object.defineProperty(handler as unknown as object, key, desc);
    }
  }

  return handler;
}

export const expect: Expect = makeExpectProxy(baseExpect);

export const test = baseTest.extend<{ heatmap: HeatmapAPI }>({
  page: async ({ page }, use, testInfo) => {
    const ctx: HeatmapContext = {
      testInfo,
      page,
      interactions: [],
      capturedIdentities: new Set(),
      identityOverride: null,
      masks: [],
    };

    await page.addInitScript(dirtyTrackerInitScript);

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        // Sticky override does not carry across pages.
        ctx.identityOverride = null;
      }
    });

    const proxied = wrapPage(page, ctx);
    ctxByPage.set(proxied as unknown as object, ctx);

    await use(proxied);

    const tmp = process.env[PWHM_TMP_ENV];
    if (!tmp || ctx.interactions.length === 0) return;
    if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
    const file = join(
      tmp,
      `worker-${testInfo.workerIndex}-${testInfo.testId}.ndjson`,
    );
    const data = ctx.interactions.map((i) => JSON.stringify(i)).join('\n') + '\n';
    try {
      appendFileSync(file, data);
    } catch {
      // best-effort; reporter will simply skip this test's data
    }
  },

  heatmap: async ({ page }, use) => {
    const ctx = getCtx(page);
    const api: HeatmapAPI = {
      async page(name: string) {
        if (!ctx) return;
        ctx.identityOverride = name;
        await ensureSnapshot(ctx);
      },
      mask(selector: string) {
        if (!ctx) return;
        ctx.masks.push(selector);
      },
      async snapshot() {
        if (!ctx) return;
        await ensureSnapshot(ctx);
      },
    };
    await use(api);
  },
});
