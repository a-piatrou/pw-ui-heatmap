import type { Page } from '@playwright/test';
import type { ElementCandidate } from './types.js';

const CANDIDATE_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[contenteditable="true"]',
  '[onclick]',
].join(', ');

export interface BrowserSnapshotResult {
  html: string;
  candidates: ElementCandidate[];
  title: string;
  viewportPx: { width: number; height: number };
}

export interface CaptureOptions {
  /** Additional CSS selector to mask in the snapshot (value/textContent replaced). */
  maskSelector?: string;
  /** Whether to drop <script> tags from the snapshot. Default true. */
  stripScripts?: boolean;
}

/**
 * Runs inside `page.evaluate`. Mutates the live DOM (tagging candidates) and
 * returns a fully self-contained HTML string + metadata.
 *
 * Limitations (v1):
 *   - Shadow DOM is not deep-walked; closed shadow roots are invisible.
 *   - Cross-origin stylesheets cannot be inlined; visual fidelity falls back to
 *     the screenshot for those cases.
 *   - Canvas/video frames are not captured.
 */
const browserSnapshotFn = function (opts: {
  candidateSelector: string;
  maskSelector: string;
  stripScripts: boolean;
}): BrowserSnapshotResult {
  const candidates: ElementCandidate[] = [];

  // Stable, deterministic per-element id: derived from the element's DOM path.
  // Same element across different browser instances / workers → same id, so
  // counts aggregate correctly across parallel workers.
  const stableId = (el: Element): string => {
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
    return 'p_' + h.toString(36);
  };

  // 1. Tag every interactable candidate with a deterministic id.
  document.querySelectorAll<HTMLElement>(opts.candidateSelector).forEach((el) => {
    let id = el.getAttribute('data-pwhm-id') ?? el.getAttribute('data-pwhm-candidate');
    if (!id) {
      id = stableId(el);
      el.setAttribute('data-pwhm-candidate', id);
    }
    const label =
      (el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        (el.textContent || '').replace(/\s+/g, ' ').trim()) ?? '';
    candidates.push({
      pwhmId: id,
      tag: el.tagName.toLowerCase(),
      label: label.slice(0, 80),
    });
  });

  // 2. Copy live form state → attributes (otherwise outerHTML loses it).
  document.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    if (input.type === 'password') {
      input.setAttribute('value', '••••••••');
      input.setAttribute('data-pwhm-masked', 'true');
    } else if (input.type === 'checkbox' || input.type === 'radio') {
      if (input.checked) input.setAttribute('checked', '');
      else input.removeAttribute('checked');
    } else if (input.type !== 'file') {
      input.setAttribute('value', input.value ?? '');
    }
  });
  document.querySelectorAll<HTMLTextAreaElement>('textarea').forEach((ta) => {
    ta.textContent = ta.value;
  });
  document.querySelectorAll<HTMLSelectElement>('select').forEach((sel) => {
    Array.from(sel.options).forEach((opt) => {
      if (opt.selected) opt.setAttribute('selected', '');
      else opt.removeAttribute('selected');
    });
  });

  // 3. Apply user-defined mask selector.
  if (opts.maskSelector) {
    try {
      document.querySelectorAll<HTMLElement>(opts.maskSelector).forEach((el) => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.setAttribute('value', '••••');
        } else {
          el.textContent = '••••';
        }
        el.setAttribute('data-pwhm-masked', 'true');
      });
    } catch {
      // bad selector — ignore
    }
  }

  // 4. Inline accessible stylesheets.
  const inlinedCss: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      const text = Array.from(rules)
        .map((r) => r.cssText)
        .join('\n');
      inlinedCss.push(text);
    } catch {
      // cross-origin — original <link> remains in the doc; it just won't load in the iframe.
    }
  }

  // 5. Build a self-contained clone.
  const docClone = document.documentElement.cloneNode(true) as HTMLElement;

  if (opts.stripScripts) {
    docClone.querySelectorAll('script').forEach((s) => s.remove());
  }
  // External stylesheets are redundant (we've inlined the accessible ones) and
  // worse — if the original server is down by the time the report is opened,
  // the iframe blocks on the failing request and never fires `load`. Removing
  // them keeps the snapshot self-contained.
  docClone.querySelectorAll('link[rel~="stylesheet"]').forEach((el) => el.remove());
  // Drop preloads / prefetches that point at the original origin too.
  docClone
    .querySelectorAll('link[rel="preload"], link[rel="prefetch"], link[rel="modulepreload"]')
    .forEach((el) => el.remove());
  docClone.querySelectorAll('link, script').forEach((el) => {
    el.removeAttribute('integrity');
    el.removeAttribute('crossorigin');
  });

  let head = docClone.querySelector('head');
  if (!head) {
    head = document.createElement('head');
    docClone.insertBefore(head, docClone.firstChild);
  }

  // <base href> so relative URLs resolve when the snapshot is viewed from the report iframe.
  const baseEl = document.createElement('base');
  baseEl.setAttribute('href', document.baseURI);
  head.insertBefore(baseEl, head.firstChild);

  if (inlinedCss.length) {
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-pwhm-inlined', 'true');
    styleEl.textContent = inlinedCss.join('\n');
    head.appendChild(styleEl);
  }

  // Marker so the overlay JS can confirm it's looking at a real snapshot doc.
  docClone.setAttribute('data-pwhm-snapshot', '1');

  const html = '<!doctype html>\n' + docClone.outerHTML;

  return {
    html,
    candidates,
    title: document.title,
    viewportPx: { width: window.innerWidth, height: window.innerHeight },
  };
};

export async function capturePageSnapshot(
  page: Page,
  options: CaptureOptions = {},
): Promise<BrowserSnapshotResult> {
  return page.evaluate(browserSnapshotFn, {
    candidateSelector: CANDIDATE_SELECTOR,
    maskSelector: options.maskSelector ?? '',
    stripScripts: options.stripScripts ?? true,
  });
}

/**
 * Installs a MutationObserver that flags significant DOM change. The fixture
 * reads `window.__pwhmDirty` and re-snapshots if set.
 */
export const dirtyTrackerInitScript = `
(() => {
  if (window.__pwhmInstalled) return;
  window.__pwhmInstalled = true;
  window.__pwhmDirty = true; // dirty until first snapshot
  let lastLen = 0;
  const recompute = () => {
    const len = document.documentElement.outerHTML.length;
    if (Math.abs(len - lastLen) / Math.max(lastLen, 1) > 0.1) {
      window.__pwhmDirty = true;
      lastLen = len;
    }
  };
  const obs = new MutationObserver(() => {
    if (window.__pwhmDirty) return;
    // Debounce via rAF
    requestAnimationFrame(recompute);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true, attributes: false });
  window.__pwhmMarkClean = () => { window.__pwhmDirty = false; lastLen = document.documentElement.outerHTML.length; };
})();
`;
