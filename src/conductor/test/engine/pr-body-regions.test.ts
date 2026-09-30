// Covers: task:1
import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_ACCEPTED_RISK_END,
  BUILD_REVIEW_ACCEPTED_RISK_HEADING,
  BUILD_REVIEW_ACCEPTED_RISK_START,
  REDUCED_BUILD_REVIEW_COVERAGE_HEADING,
} from '../../src/engine/build-review-accepted-risk.js';
import { PR_BODY_FLOOR_MARKER } from '../../src/engine/halt-pr-rehabilitation.js';
import {
  HALT_PR_BANNER_SENTINEL,
  NEEDS_REMEDIATION_BODY_MARKER,
} from '../../src/engine/pr-labels.js';
import {
  extractRegionBytes,
  isEmptyRegion,
  maskProjectOwnedRegions,
  parsePrTemplateRegions,
  restoreRegion,
} from '../../src/engine/pr-body-regions.js';

describe('parsePrTemplateRegions', () => {
  it('returns each marked region with its key and exact bytes between the markers', () => {
    const template = [
      '# Pull request',
      '<!-- ai-conductor:step compliance-attest -->',
      'Attested-By: security-bot',
      '',
      '<!-- machine: opaque -->',
      '<!-- /ai-conductor:step -->',
      '',
      '<!-- ai-conductor:step release-disposition -->',
      'Release-Disposition: no-note',
      '<!-- /ai-conductor:step -->',
    ].join('\n');

    expect(parsePrTemplateRegions(template)).toEqual({
      ok: true,
      regions: [
        {
          key: 'compliance-attest',
          bytes: '\nAttested-By: security-bot\n\n<!-- machine: opaque -->\n',
        },
        {
          key: 'release-disposition',
          bytes: '\nRelease-Disposition: no-note\n',
        },
      ],
    });
  });

  it('returns no regions for a template without markers', () => {
    expect(parsePrTemplateRegions('# Pull request\n\n## Summary\n')).toEqual({ ok: true, regions: [] });
  });

  it('preserves CRLF bytes between region markers', () => {
    const template = '<!-- ai-conductor:step compliance-attest -->\r\nAttested-By: security-bot\r\n<!-- /ai-conductor:step -->';

    expect(parsePrTemplateRegions(template)).toEqual({
      ok: true,
      regions: [{ key: 'compliance-attest', bytes: '\r\nAttested-By: security-bot\r\n' }],
    });
  });

  it('returns a typed error naming an unclosed region key', () => {
    expect(parsePrTemplateRegions('<!-- ai-conductor:step compliance-attest -->\nAttested')).toEqual({
      ok: false,
      error: { kind: 'unclosed-region', key: 'compliance-attest' },
    });
  });

  it('returns a typed error naming both keys when a region is nested', () => {
    expect(parsePrTemplateRegions([
      '<!-- ai-conductor:step compliance-attest -->',
      '<!-- ai-conductor:step release-disposition -->',
      '<!-- /ai-conductor:step -->',
      '<!-- /ai-conductor:step -->',
    ].join('\n'))).toEqual({
      ok: false,
      error: {
        kind: 'nested-region',
        outerKey: 'compliance-attest',
        innerKey: 'release-disposition',
      },
    });
  });

  it('returns a typed error naming a duplicated region key', () => {
    expect(parsePrTemplateRegions([
      '<!-- ai-conductor:step compliance-attest -->',
      '<!-- /ai-conductor:step -->',
      '<!-- ai-conductor:step compliance-attest -->',
      '<!-- /ai-conductor:step -->',
    ].join('\n'))).toEqual({
      ok: false,
      error: { kind: 'duplicate-region-key', key: 'compliance-attest' },
    });
  });

  it.each([
    [REDUCED_BUILD_REVIEW_COVERAGE_HEADING],
    [BUILD_REVIEW_ACCEPTED_RISK_HEADING],
    [BUILD_REVIEW_ACCEPTED_RISK_START],
    [BUILD_REVIEW_ACCEPTED_RISK_END],
    [PR_BODY_FLOOR_MARKER],
    [NEEDS_REMEDIATION_BODY_MARKER],
    [HALT_PR_BANNER_SENTINEL],
  ])('returns a typed error when a region contains engine-owned text %s', (engineOwnedText) => {
    expect(parsePrTemplateRegions([
      '<!-- ai-conductor:step compliance-attest -->',
      engineOwnedText,
      '<!-- /ai-conductor:step -->',
    ].join('\n'))).toEqual({
      ok: false,
      error: {
        kind: 'engine-owned-text',
        key: 'compliance-attest',
        text: engineOwnedText,
      },
    });
  });
});

// Covers: task:5
describe('project-owned region restoration', () => {
  const region = {
    key: 'compliance-attest',
    bytes: '\nAttested-By: security-bot\n<!-- opaque: preserve -->\n',
  };
  const rendered = '<!-- ai-conductor:step compliance-attest -->\nAttested-By: security-bot\n<!-- opaque: preserve -->\n<!-- /ai-conductor:step -->';

  it('appends an omitted region after the existing body without interpreting its bytes', () => {
    const body = '# Pull request\n\nSummary here.';

    expect(restoreRegion(body, region)).toBe(`${body}\n\n${rendered}`);
  });

  it('replaces altered bytes in place', () => {
    const body = [
      '# Pull request',
      '<!-- ai-conductor:step compliance-attest -->',
      'Attested-By: someone-else',
      '<!-- /ai-conductor:step -->',
      '## Details',
    ].join('\n');

    expect(restoreRegion(body, region)).toBe([
      '# Pull request',
      rendered,
      '## Details',
    ].join('\n'));
  });

  it('collapses duplicate regions to the one captured region', () => {
    const body = [
      '# Pull request',
      '<!-- ai-conductor:step compliance-attest -->',
      'first altered copy',
      '<!-- /ai-conductor:step -->',
      '<!-- ai-conductor:step compliance-attest -->',
      'second altered copy',
      '<!-- /ai-conductor:step -->',
    ].join('\n');

    const restored = restoreRegion(body, region);
    expect(restored.match(/<!-- ai-conductor:step compliance-attest -->/g)).toHaveLength(1);
    expect(restored).toContain(rendered);
    expect(restored).not.toContain('altered copy');
  });

  it('returns the original string when the region is already byte-identical', () => {
    const body = `# Pull request\n${rendered}\n`;

    expect(restoreRegion(body, region)).toBe(body);
  });

  it('recognizes whitespace and HTML comments as an empty region', () => {
    expect(isEmptyRegion('\n  <!-- pending -->\n\t<!-- another comment -->\n')).toBe(true);
    expect(isEmptyRegion('\nAttested-By: security-bot\n')).toBe(false);
  });

  it('extracts runtime bytes opaquely even when template validation would reject them', () => {
    const body = [
      '<!-- ai-conductor:step compliance-attest -->',
      BUILD_REVIEW_ACCEPTED_RISK_START,
      'Attested-By: security-bot',
      '<!-- /ai-conductor:step -->',
    ].join('\n');

    expect(extractRegionBytes(body, 'compliance-attest')).toBe(
      `\n${BUILD_REVIEW_ACCEPTED_RISK_START}\nAttested-By: security-bot\n`,
    );
    expect(parsePrTemplateRegions(body)).toMatchObject({ ok: false });
  });

  it('masks region contents while retaining offsets and line endings for engine searches', () => {
    const body = `Before\n${rendered}\nAfter`;
    const masked = maskProjectOwnedRegions(body);
    expect(masked).toHaveLength(body.length);
    expect(masked).toContain('Before\n');
    expect(masked).toContain('\nAfter');
    expect(masked).not.toContain('Attested-By: security-bot');
  });
});
