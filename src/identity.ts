import { createHash } from 'node:crypto';
import type { PageIdentity, ViewportBucket } from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONGO_OID_RE = /^[0-9a-f]{24}$/i;
const NUMERIC_RE = /^\d+$/;
const HEX_RE = /^[0-9a-f]{16,}$/i;
const BASE64ISH_RE = /^[A-Za-z0-9_-]{16,}$/;

function isParamSegment(segment: string): boolean {
  if (NUMERIC_RE.test(segment)) return true;
  if (UUID_RE.test(segment)) return true;
  if (MONGO_OID_RE.test(segment)) return true;
  if (HEX_RE.test(segment)) return true;
  if (BASE64ISH_RE.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment)) return true;
  return false;
}

export function templateUrl(rawUrl: string, opts?: { includeQueryParams?: boolean }): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const segments = url.pathname.split('/').map((seg) => (isParamSegment(seg) ? ':id' : seg));
  let path = segments.join('/') || '/';
  if (opts?.includeQueryParams && url.search) {
    path += url.search;
  }
  return path;
}

export function viewportBucket(width: number): ViewportBucket {
  if (width < 600) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

function hashId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

/** Identity from auto-templated URL. */
export function autoIdentity(
  rawUrl: string,
  viewport: { width: number; height: number },
  opts?: { includeQueryParams?: boolean },
): PageIdentity {
  const urlTemplate = templateUrl(rawUrl, opts);
  const bucket = viewportBucket(viewport.width);
  const id = hashId(`auto::${urlTemplate}::${bucket}`);
  return {
    id,
    name: urlTemplate,
    urlTemplate,
    sampleUrl: rawUrl,
    viewport: bucket,
    explicit: false,
  };
}

/** Identity from explicit name. */
export function explicitIdentity(
  name: string,
  rawUrl: string,
  viewport: { width: number; height: number },
): PageIdentity {
  const bucket = viewportBucket(viewport.width);
  const id = hashId(`explicit::${name}::${bucket}`);
  return {
    id,
    name,
    urlTemplate: templateUrl(rawUrl),
    sampleUrl: rawUrl,
    viewport: bucket,
    explicit: true,
  };
}
