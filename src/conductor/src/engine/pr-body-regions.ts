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
