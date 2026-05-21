export type ActionKind =
  | 'click'
  | 'dblclick'
  | 'tap'
  | 'hover'
  | 'fill'
  | 'type'
  | 'pressSequentially'
  | 'press'
  | 'check'
  | 'uncheck'
  | 'selectOption'
  | 'setInputFiles'
  | 'dragTo'
  | 'focus'
  | 'blur'
  | 'clear'
  | 'scrollIntoViewIfNeeded'
  | 'assert.visible'
  | 'assert.hidden'
  | 'assert.enabled'
  | 'assert.disabled'
  | 'assert.checked'
  | 'assert.text'
  | 'assert.value'
  | 'assert.attribute'
  | 'assert.count'
  | 'assert.editable';

export type ViewportBucket = 'mobile' | 'tablet' | 'desktop';

export interface PageIdentity {
  /** Stable hash key used in filenames and `data.json`. */
  id: string;
  /** Display name — either user-provided via heatmap.page() or auto from URL. */
  name: string;
  /** Templated URL path (e.g. `/users/:id`). Empty for explicit-only identities. */
  urlTemplate: string;
  /** Raw URL of the first capture (useful for debugging). */
  sampleUrl: string;
  /** Viewport bucket; identities split across viewports. */
  viewport: ViewportBucket;
  /** Whether the user explicitly named this identity. */
  explicit: boolean;
}

export interface Interaction {
  /** `PageIdentity.id` */
  pageId: string;
  /** UUID attached to the live DOM element via `data-pwhm-id`. */
  pwhmId: string;
  action: ActionKind;
  /** Test that recorded the interaction (for tooltip attribution). */
  testTitle: string;
  testId: string;
  /** ISO timestamp. */
  ts: string;
  /** Optional, e.g. selector text used in test. Stored for tooltip context. */
  selectorHint?: string;
}

export interface ElementCandidate {
  /** UUID written to `data-pwhm-candidate` on snapshot elements. */
  pwhmId: string;
  tag: string;
  /** Best-effort accessible name for tooltip. */
  label?: string;
}

export interface PageSnapshotMeta {
  pageId: string;
  /** Relative path inside the report (e.g. `pages/<hash>/snapshot.html`). */
  snapshotPath: string;
  /** Relative path inside the report (e.g. `pages/<hash>/screenshot.png`). */
  screenshotPath: string;
  /** Title element of the captured page (for the page index). */
  title: string;
  /** All candidate interactable elements detected at snapshot time. */
  candidates: ElementCandidate[];
  /** Captured viewport size in CSS pixels. */
  viewportPx: { width: number; height: number };
}

export interface AggregatedPage {
  identity: PageIdentity;
  snapshot: PageSnapshotMeta;
  /** Per-element aggregated counts. */
  elements: Array<{
    pwhmId: string;
    /** Total interactions of any kind. */
    total: number;
    /** Per-action-type counts. */
    byAction: Partial<Record<ActionKind, number>>;
    /** Test titles that touched this element. */
    tests: string[];
  }>;
  /** Coverage % = covered candidates / total candidates. */
  coverage: number;
}

export interface ReportData {
  generatedAt: string;
  pages: AggregatedPage[];
  /** Run-level summary. */
  summary: {
    totalPages: number;
    totalInteractions: number;
    overallCoverage: number;
  };
}

export interface ReporterOptions {
  /** Where to write the report. Defaults to `./heatmap-report`. */
  outputDir?: string;
  /** Override tmp dir (default: `<outputDir>/.tmp`). */
  tmpDir?: string;
  /** Record `expect()` assertions as interactions. Default: true. */
  recordAssertions?: boolean;
  /** Open report in browser after generation. Default: false. */
  open?: boolean;
  /** Custom thresholds for outline color. */
  thresholds?: {
    /** counts <= this → orange. Default 2. */
    orange: number;
  };
  /** Custom URL template rules. */
  identity?: {
    includeQueryParams?: boolean;
  };
}
