import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ReportData, ReporterOptions } from '../types.js';

export interface GenerateOptions {
  outputDir: string;
  tmpDir: string;
  templateDir: string;
  data: ReportData;
  thresholds: NonNullable<ReporterOptions['thresholds']>;
}

export async function generateReport(opts: GenerateOptions): Promise<void> {
  const { outputDir, tmpDir, templateDir, data, thresholds } = opts;

  mkdirSync(outputDir, { recursive: true });

  // 1. Copy static assets folder to outputDir/assets.
  const assetsSrc = join(templateDir, 'assets');
  const assetsDst = join(outputDir, 'assets');
  if (existsSync(assetsSrc)) {
    cpSync(assetsSrc, assetsDst, { recursive: true });
  }

  // 2. Copy index.html as-is.
  const indexSrc = join(templateDir, 'index.html');
  const indexDst = join(outputDir, 'index.html');
  if (existsSync(indexSrc)) {
    copyFileSync(indexSrc, indexDst);
  }

  // 3. Write data.json.
  writeFileSync(join(outputDir, 'data.json'), JSON.stringify(data, null, 2), 'utf8');

  // 4. Per-page output.
  const pageTemplatePath = join(templateDir, 'page.html');
  const pageTemplate = existsSync(pageTemplatePath)
    ? readFileSync(pageTemplatePath, 'utf8')
    : null;
  if (!pageTemplate) {
    throw new Error('[pw-ui-heatmap] page.html template not found in ' + templateDir);
  }

  const pagesDir = join(outputDir, 'pages');
  mkdirSync(pagesDir, { recursive: true });

  for (const page of data.pages) {
    const id = page.identity.id;
    const dst = join(pagesDir, id);
    mkdirSync(dst, { recursive: true });

    // Snapshot HTML
    const srcSnapshot = join(tmpDir, 'snapshots', id, 'snapshot.html');
    if (existsSync(srcSnapshot)) {
      copyFileSync(srcSnapshot, join(dst, 'snapshot.html'));
    } else {
      writeFileSync(
        join(dst, 'snapshot.html'),
        '<!doctype html><html><body><p>Snapshot missing</p></body></html>',
        'utf8',
      );
    }

    // Screenshot (optional)
    const srcShot = join(tmpDir, 'snapshots', id, 'screenshot.png');
    if (existsSync(srcShot)) {
      copyFileSync(srcShot, join(dst, 'screenshot.png'));
    }

    // Stamped index.html
    const html = pageTemplate
      .replaceAll('{{PAGE_ID}}', id)
      .replaceAll('{{PAGE_NAME}}', escapeHtmlAttr(page.identity.name))
      .replaceAll('{{THRESHOLDS_JSON}}', JSON.stringify(thresholds));
    writeFileSync(join(dst, 'index.html'), html, 'utf8');
  }
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}
