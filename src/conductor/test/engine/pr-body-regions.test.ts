// Covers: task:1
import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_ACCEPTED_RISK_START,
  REDUCED_BUILD_REVIEW_COVERAGE_HEADING,
} from '../../src/engine/build-review-accepted-risk.js';
import { parsePrTemplateRegions } from '../../src/engine/pr-body-regions.js';

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
    [BUILD_REVIEW_ACCEPTED_RISK_START],
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
