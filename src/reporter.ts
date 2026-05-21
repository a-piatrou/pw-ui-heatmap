import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig, FullResult, Reporter } from '@playwright/test/reporter';
import { generateReport } from './generator/index.js';
import { PWHM_TMP_ENV } from './fixture.js';
import type {
  AggregatedPage,
  Interaction,
  PageIdentity,
  PageSnapshotMeta,
  ReportData,
  ReporterOptions,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveDir(input: string | undefined, fallback: string, cwd: string): string {
  const value = input ?? fallback;
  return isAbsolute(value) ? value : resolve(cwd, value);
}

export default class HeatmapReporter implements Reporter {
  private outputDir!: string;
  private tmpDir!: string;
  private opts: ReporterOptions;

  constructor(opts: ReporterOptions = {}) {
    this.opts = opts;
  }

  onBegin(config: FullConfig): void {
    // Resolve relative outputDir against the directory containing the
    // Playwright config file — that's what users intuitively expect — and only
    // fall back to config.rootDir / cwd if no config file is detected.
    const cwd =
      (config.configFile && dirname(config.configFile)) ||
      config.rootDir ||
      process.cwd();
    this.outputDir = resolveDir(this.opts.outputDir, 'heatmap-report', cwd);
    this.tmpDir = resolveDir(this.opts.tmpDir, join(this.outputDir, '.tmp'), cwd);

    if (existsSync(this.tmpDir)) {
      rmSync(this.tmpDir, { recursive: true, force: true });
    }
    mkdirSync(this.tmpDir, { recursive: true });
    process.env[PWHM_TMP_ENV] = this.tmpDir;
  }

  async onEnd(result: FullResult): Promise<void> {
    if (!this.tmpDir || !existsSync(this.tmpDir)) {
      // onBegin was never called (no tests ran)
      return;
    }

    const interactions = readInteractions(this.tmpDir);
    const snapshots = readSnapshots(this.tmpDir);
    if (snapshots.length === 0) {
      console.log('[pw-ui-heatmap] no page snapshots captured — nothing to report.');
      return;
    }

    const report = aggregate(interactions, snapshots);

    if (existsSync(this.outputDir)) {
      // Wipe stale per-page folders but keep top-level user files (if any).
      const pagesDir = join(this.outputDir, 'pages');
      if (existsSync(pagesDir)) rmSync(pagesDir, { recursive: true, force: true });
    }
    mkdirSync(this.outputDir, { recursive: true });

    const templateDir = resolveReportTemplateDir();
    await generateReport({
      outputDir: this.outputDir,
      tmpDir: this.tmpDir,
      templateDir,
      data: report,
      thresholds: this.opts.thresholds ?? { orange: 2 },
    });

    // Clean up tmp dir to keep the report tree tidy.
    try {
      rmSync(this.tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    const ok = result.status === 'passed' || result.status === 'failed';
    if (!ok) return;
    console.log(`[pw-ui-heatmap] report written to ${this.outputDir}`);
    console.log(
      `[pw-ui-heatmap] open with: npx pw-ui-heatmap serve "${this.outputDir}"`,
    );
  }
}

function resolveReportTemplateDir(): string {
  // dist sits at <pkg>/dist; template lives at <pkg>/report-template.
  const candidates = [
    resolve(__dirname, '..', 'report-template'),
    resolve(__dirname, '..', '..', 'report-template'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    '[pw-ui-heatmap] could not locate report-template directory next to dist/',
  );
}

function readInteractions(tmpDir: string): Interaction[] {
  const out: Interaction[] = [];
  const entries = readdirSync(tmpDir);
  for (const e of entries) {
    if (!e.endsWith('.ndjson')) continue;
    const p = join(tmpDir, e);
    let raw = '';
    try {
      raw = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as Interaction);
      } catch {
        // skip malformed line
      }
    }
  }
  return out;
}

interface RawSnapshot {
  identity: PageIdentity;
  meta: PageSnapshotMeta;
  /** Absolute filesystem path of the captured HTML. */
  htmlPath: string;
  /** Absolute filesystem path of the captured screenshot, or null. */
  screenshotPath: string | null;
}

function readSnapshots(tmpDir: string): RawSnapshot[] {
  const snapDir = join(tmpDir, 'snapshots');
  if (!existsSync(snapDir)) return [];
  const out: RawSnapshot[] = [];
  for (const id of readdirSync(snapDir)) {
    const dir = join(snapDir, id);
    if (!statSync(dir).isDirectory()) continue;
    const metaPath = join(dir, 'meta.json');
    const htmlPath = join(dir, 'snapshot.html');
    if (!existsSync(metaPath) || !existsSync(htmlPath)) continue;
    try {
      const raw = readFileSync(metaPath, 'utf8');
      const parsed = JSON.parse(raw) as { identity: PageIdentity; meta: PageSnapshotMeta };
      const shotPath = join(dir, 'screenshot.png');
      out.push({
        identity: parsed.identity,
        meta: parsed.meta,
        htmlPath,
        screenshotPath: existsSync(shotPath) ? shotPath : null,
      });
    } catch {
      // skip corrupt
    }
  }
  return out;
}

function aggregate(interactions: Interaction[], snapshots: RawSnapshot[]): ReportData {
  const pages: AggregatedPage[] = [];

  for (const snap of snapshots) {
    const candidateIds = new Set(snap.meta.candidates.map((c) => c.pwhmId));
    const elementMap = new Map<
      string,
      {
        pwhmId: string;
        total: number;
        byAction: Record<string, number>;
        tests: Set<string>;
      }
    >();

    for (const i of interactions) {
      if (i.pageId !== snap.identity.id) continue;
      let entry = elementMap.get(i.pwhmId);
      if (!entry) {
        entry = { pwhmId: i.pwhmId, total: 0, byAction: {}, tests: new Set() };
        elementMap.set(i.pwhmId, entry);
      }
      entry.total++;
      entry.byAction[i.action] = (entry.byAction[i.action] ?? 0) + 1;
      entry.tests.add(i.testTitle);
    }

    // Include every snapshot candidate, even if untouched (red overlay candidates).
    for (const c of snap.meta.candidates) {
      if (!elementMap.has(c.pwhmId)) {
        elementMap.set(c.pwhmId, {
          pwhmId: c.pwhmId,
          total: 0,
          byAction: {},
          tests: new Set(),
        });
      }
    }

    const touchedCandidates = snap.meta.candidates.filter(
      (c) => (elementMap.get(c.pwhmId)?.total ?? 0) > 0,
    ).length;
    const coverage =
      candidateIds.size === 0 ? 0 : touchedCandidates / candidateIds.size;

    pages.push({
      identity: snap.identity,
      snapshot: snap.meta,
      elements: Array.from(elementMap.values()).map((e) => ({
        pwhmId: e.pwhmId,
        total: e.total,
        byAction: e.byAction,
        tests: Array.from(e.tests),
      })),
      coverage,
    });
  }

  pages.sort((a, b) => a.identity.name.localeCompare(b.identity.name));

  const totalInteractions = interactions.length;
  const overallCoverage =
    pages.length === 0
      ? 0
      : pages.reduce((sum, p) => sum + p.coverage, 0) / pages.length;

  return {
    generatedAt: new Date().toISOString(),
    pages,
    summary: {
      totalPages: pages.length,
      totalInteractions,
      overallCoverage,
    },
  };
}
