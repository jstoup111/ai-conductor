import {
  BUILD_REVIEW_ACCEPTED_RISK_START,
  REDUCED_BUILD_REVIEW_COVERAGE_HEADING,
} from './build-review-accepted-risk.js';

export type PrTemplateRegion = {
  readonly key: string;
  readonly bytes: string;
};

export type PrTemplateRegionParseError =
  | { readonly kind: 'unclosed-region'; readonly key: string }
  | { readonly kind: 'nested-region'; readonly outerKey: string; readonly innerKey: string }
  | { readonly kind: 'duplicate-region-key'; readonly key: string }
  | { readonly kind: 'unexpected-closing-marker' }
  | { readonly kind: 'engine-owned-text'; readonly key: string; readonly text: string };

export type ParsePrTemplateRegionsResult =
  | { readonly ok: true; readonly regions: readonly PrTemplateRegion[] }
  | { readonly ok: false; readonly error: PrTemplateRegionParseError };

const MARKER = /(^|\r?\n)(<!-- ai-conductor:step ([^\r\n]+) -->|<!-- \/ai-conductor:step -->)(?=\r?\n|$)/g;
const CLOSING_MARKER = '<!-- /ai-conductor:step -->';

function markersFor(key: string): { readonly start: string; readonly end: string } {
  return { start: `<!-- ai-conductor:step ${key} -->`, end: CLOSING_MARKER };
}

/** Restores one captured region without interpreting any of its captured bytes. */
export function restoreRegion(body: string, region: PrTemplateRegion): string {
  const { start, end } = markersFor(region.key);
  const restored = `${start}${region.bytes}${end}`;
  const ranges: Array<{ readonly start: number; readonly end: number }> = [];
  let cursor = 0;

  while (true) {
    const regionStart = body.indexOf(start, cursor);
    if (regionStart === -1) break;
    const closingStart = body.indexOf(end, regionStart + start.length);
    if (closingStart === -1) break;
    ranges.push({ start: regionStart, end: closingStart + end.length });
    cursor = closingStart + end.length;
  }

  if (ranges.length === 0) {
    if (body.length === 0) return restored;
    return `${body}${body.endsWith('\n') ? '\n' : '\n\n'}${restored}`;
  }
  if (ranges.length === 1 && body.slice(ranges[0].start, ranges[0].end) === restored) return body;

  let next = body.slice(0, ranges[0].start) + restored;
  let previousEnd = ranges[0].end;
  for (const duplicate of ranges.slice(1)) {
    next += body.slice(previousEnd, duplicate.start);
    previousEnd = duplicate.end;
  }
  return next + body.slice(previousEnd);
}

/** A region is empty when it contains only whitespace and HTML comments. */
export function isEmptyRegion(bytes: string): boolean {
  return bytes.replace(/<!--[\s\S]*?-->/g, '').trim().length === 0;
}

/** Parses project-owned, step-keyed regions without interpreting their contents. */
export function parsePrTemplateRegions(template: string): ParsePrTemplateRegionsResult {
  const regions: PrTemplateRegion[] = [];
  const keys = new Set<string>();
  let open: { readonly key: string; readonly contentStart: number } | undefined;

  for (const match of template.matchAll(MARKER)) {
    const marker = match[2];
    const markerStart = match.index! + match[1].length;
    const markerEnd = markerStart + marker.length;
    if (marker === CLOSING_MARKER) {
      if (open === undefined) return { ok: false, error: { kind: 'unexpected-closing-marker' } };
      const bytes = template.slice(open.contentStart, markerStart);
      const engineOwnedText = [REDUCED_BUILD_REVIEW_COVERAGE_HEADING, BUILD_REVIEW_ACCEPTED_RISK_START]
        .find((text) => bytes.includes(text));
      if (engineOwnedText !== undefined) {
        return { ok: false, error: { kind: 'engine-owned-text', key: open.key, text: engineOwnedText } };
      }
      regions.push({ key: open.key, bytes });
      open = undefined;
      continue;
    }

    const key = match[3];
    if (open !== undefined) {
      return { ok: false, error: { kind: 'nested-region', outerKey: open.key, innerKey: key } };
    }
    if (keys.has(key)) return { ok: false, error: { kind: 'duplicate-region-key', key } };
    keys.add(key);
    open = { key, contentStart: markerEnd };
  }

  if (open !== undefined) return { ok: false, error: { kind: 'unclosed-region', key: open.key } };
  return { ok: true, regions };
}
