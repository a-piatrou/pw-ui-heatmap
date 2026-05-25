#!/usr/bin/env node
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import { Command } from 'commander';
import sirv from 'sirv';
import type { AggregatedPage, ReportData } from './types.js';

function abs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

const program = new Command();
program
  .name('pw-ui-heatmap')
  .description('Serve and merge pw-ui-heatmap reports.')
  .version('0.1.0');

program
  .command('serve')
  .argument('[dir]', 'report directory', 'heatmap-report')
  .option('-p, --port <port>', 'preferred port (default: auto)', (v) => parseInt(v, 10))
  .option('--host <host>', 'bind host', '127.0.0.1')
  .option('--no-open', 'do not auto-open the browser')
  .description('Serve a generated report from a local web server')
  .action(async (dirArg: string, opts: { port?: number; host: string; open: boolean }) => {
    const dir = abs(dirArg);
    if (!existsSync(dir)) {
      console.error(`Directory not found: ${dir}`);
      process.exit(1);
    }
    if (!existsSync(join(dir, 'index.html'))) {
      console.error(`No index.html in ${dir} — is this a heatmap report?`);
      process.exit(1);
    }

    // `dev: true` re-stats files on every request so a fresh report after a
    // test rerun is served without restarting the server.
    const handler = sirv(dir, { dev: true, single: false, etag: false });
    const server = http.createServer((req, res) => {
      handler(req, res, () => {
        res.statusCode = 404;
        res.end('Not Found');
      });
    });

    const port = await listen(server, opts.port ?? 0, opts.host);
    const url = `http://${opts.host}:${port}/`;
    console.log(`[pw-ui-heatmap] serving ${dir}`);
    console.log(`[pw-ui-heatmap] open ${url}  (Ctrl-C to stop)`);

    if (opts.open) {
      try {
        const { default: open } = await import('open');
        await open(url);
      } catch {
        // optional dep / display problem — ignore
      }
    }
  });

program
  .command('merge')
  .argument('<inputs...>', 'report directories to merge')
  .requiredOption('-o, --output <dir>', 'destination report directory')
  .description('Merge multiple report directories (e.g. from sharded CI)')
  .action((inputs: string[], opts: { output: string }) => {
    const outDir = abs(opts.output);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const merged: ReportData = {
      generatedAt: new Date().toISOString(),
      pages: [],
      summary: { totalPages: 0, totalInteractions: 0, overallCoverage: 0 },
    };

    const pageById = new Map<string, AggregatedPage>();
    let firstTemplate: string | null = null;

    for (const input of inputs) {
      const inDir = abs(input);
      const dataPath = join(inDir, 'data.json');
      if (!existsSync(dataPath)) {
        console.warn(`[merge] skipping ${inDir}: no data.json`);
        continue;
      }
      const data = JSON.parse(readFileSync(dataPath, 'utf8')) as ReportData;
      for (const p of data.pages) {
        const existing = pageById.get(p.identity.id);
        if (!existing) {
          pageById.set(p.identity.id, deepClone(p));
          // copy page folder
          const src = join(inDir, 'pages', p.identity.id);
          const dst = join(outDir, 'pages', p.identity.id);
          if (existsSync(src)) cpSync(src, dst, { recursive: true });
        } else {
          mergeAggregatedPage(existing, p);
        }
      }
      // Copy assets + index.html + page.html only from the first input.
      if (firstTemplate === null) {
        const assets = join(inDir, 'assets');
        if (existsSync(assets)) cpSync(assets, join(outDir, 'assets'), { recursive: true });
        const index = join(inDir, 'index.html');
        if (existsSync(index)) cpSync(index, join(outDir, 'index.html'));
        firstTemplate = inDir;
      }
    }

    merged.pages = Array.from(pageById.values()).sort((a, b) =>
      a.identity.name.localeCompare(b.identity.name),
    );
    merged.summary.totalPages = merged.pages.length;
    merged.summary.totalInteractions = merged.pages.reduce(
      (sum, p) => sum + p.elements.reduce((s, e) => s + e.total, 0),
      0,
    );
    merged.summary.overallCoverage =
      merged.pages.length === 0
        ? 0
        : merged.pages.reduce((s, p) => s + p.coverage, 0) / merged.pages.length;

    writeFileSync(join(outDir, 'data.json'), JSON.stringify(merged, null, 2), 'utf8');
    console.log(`[merge] wrote ${merged.pages.length} pages → ${outDir}`);
  });

program.parseAsync(process.argv);

function listen(server: http.Server, preferredPort: number, host: string): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    server.once('error', rejectP);
    server.listen(preferredPort, host, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolveP(addr.port);
      else rejectP(new Error('failed to listen'));
    });
  });
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeAggregatedPage(target: AggregatedPage, src: AggregatedPage): void {
  const byId = new Map<string, AggregatedPage['elements'][number]>();
  target.elements.forEach((e) => byId.set(e.pwhmId, e));

  for (const e of src.elements) {
    const existing = byId.get(e.pwhmId);
    if (!existing) {
      target.elements.push(deepClone(e));
      byId.set(e.pwhmId, target.elements[target.elements.length - 1]!);
    } else {
      existing.total += e.total;
      const srcByAction = e.byAction as Record<string, number>;
      const dstByAction = existing.byAction as Record<string, number>;
      for (const k of Object.keys(srcByAction)) {
        dstByAction[k] = (dstByAction[k] ?? 0) + (srcByAction[k] ?? 0);
      }
      const seen = new Set(existing.tests);
      for (const t of e.tests) seen.add(t);
      existing.tests = Array.from(seen);
    }
  }

  // Recompute coverage from the merged candidate set.
  const candidateIds = new Set(target.snapshot.candidates.map((c) => c.pwhmId));
  const touched = target.elements.filter(
    (e) => candidateIds.has(e.pwhmId) && e.total > 0,
  ).length;
  target.coverage = candidateIds.size === 0 ? 0 : touched / candidateIds.size;
}
