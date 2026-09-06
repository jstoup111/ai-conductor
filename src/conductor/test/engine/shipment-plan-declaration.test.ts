// Covers: task:1
import { describe, expect, it } from 'vitest';

import {
  extractShipmentPlanDeclarations,
  upsertShipmentPlanDeclaration,
} from '../../src/engine/shipment-plan-declaration.js';

describe('shipment plan declarations', () => {
  it.each([
    ['a plain declaration', 'Plan: .docs/plans/feature.md', ['feature']],
    ['a backticked declaration', 'Plan: `.docs/plans/feature.md`', ['feature']],
    ['trailing horizontal whitespace', 'Plan: .docs/plans/feature.md\t  ', ['feature']],
    ['repeated identical declarations', [
      'Plan: .docs/plans/feature.md',
      'Plan: `.docs/plans/feature.md`',
    ].join('\n'), ['feature']],
    ['distinct declarations without choosing one', [
      'Plan: .docs/plans/first.md',
      'Plan: .docs/plans/second.md',
    ].join('\n'), ['first', 'second']],
    ['ordinary prose', 'See .docs/plans/feature.md for details.', []],
    ['a blockquote', '> Plan: .docs/plans/feature.md', []],
    ['indented code', '    Plan: .docs/plans/feature.md', []],
    ['a backtick fence', '```md\nPlan: .docs/plans/feature.md\n```', []],
    ['a tilde fence', '~~~md\nPlan: .docs/plans/feature.md\n~~~', []],
    ['an indented backtick fence', ' ```md\nPlan: .docs/plans/feature.md\n ```', []],
    ['an indented tilde fence', '  ~~~md\nPlan: .docs/plans/feature.md\n  ~~~', []],
    ['an HTML comment', '<!--\nPlan: .docs/plans/feature.md\n-->', []],
    ['an unterminated fence', '```\nPlan: .docs/plans/feature.md', []],
    ['a fence closed with the wrong character', '```\nPlan: .docs/plans/feature.md\n~~~', []],
    ['a fence closed with too few characters', '````\nPlan: .docs/plans/feature.md\n```', []],
    ['an unterminated comment', '<!--\nPlan: .docs/plans/feature.md', []],
    ['a path with traversal', 'Plan: .docs/plans/../feature.md', []],
    ['a nested path', 'Plan: .docs/plans/nested/feature.md', []],
    ['a doubled path separator', 'Plan: .docs/plans//feature.md', []],
    ['a backslash path separator', 'Plan: .docs\\plans\\feature.md', []],
    ['a backslash filename separator', 'Plan: .docs/plans/nested\\feature.md', []],
    ['a path with whitespace', 'Plan: .docs/plans/feature name.md', []],
    ['a path with suffix text', 'Plan: .docs/plans/feature.md is ready', []],
    ['a declaration without required spacing', 'Plan:.docs/plans/feature.md', []],
    ['a declaration with extra spacing before the path', 'Plan:  .docs/plans/feature.md', []],
    ['a declaration with a space before its wrapper', 'Plan: `.docs/plans/feature.md` ', ['feature']],
    ['a declaration with spacing inside its wrapper', 'Plan: ` .docs/plans/feature.md`', []],
    ['a declaration with multiple backtick wrappers', 'Plan: ``.docs/plans/feature.md``', []],
    ['a declaration with an unmatched backtick wrapper', 'Plan: `.docs/plans/feature.md', []],
    ['an empty path', 'Plan: .docs/plans/.md', []],
  ] as const)('extracts only %s', (_caseName, body, expected) => {
    expect(extractShipmentPlanDeclarations(body)).toEqual(expected);
  });

  it('replaces recognized declarations while preserving surrounding and quoted text', () => {
    const body = [
      'Overview',
      'Plan: .docs/plans/stale.md',
      '> Plan: .docs/plans/quoted.md',
      '```md',
      'Plan: .docs/plans/example.md',
      '```',
      'Closing note',
    ].join('\n');

    expect(upsertShipmentPlanDeclaration(body, 'canonical')).toBe([
      'Overview',
      'Plan: .docs/plans/canonical.md',
      '> Plan: .docs/plans/quoted.md',
      '```md',
      'Plan: .docs/plans/example.md',
      '```',
      'Closing note',
    ].join('\n'));
  });

  it('appends a missing declaration and leaves canonical input byte-identical', () => {
    expect(upsertShipmentPlanDeclaration('Overview\n', 'feature')).toBe(
      'Overview\nPlan: .docs/plans/feature.md\n',
    );
    expect(upsertShipmentPlanDeclaration('Plan: .docs/plans/feature.md\n', 'feature')).toBe(
      'Plan: .docs/plans/feature.md\n',
    );
  });

  it('consolidates distinct declarations once and is idempotent on the repeated result', () => {
    const body = [
      'Overview',
      'Plan: .docs/plans/first.md',
      'Context that must remain',
      'Plan: `.docs/plans/second.md`',
      'Closing note',
    ].join('\n');
    const expected = [
      'Overview',
      'Plan: .docs/plans/canonical.md',
      'Context that must remain',
      'Closing note',
    ].join('\n');

    const once = upsertShipmentPlanDeclaration(body, 'canonical');
    expect(once).toBe(expected);
    expect(upsertShipmentPlanDeclaration(once, 'canonical')).toBe(once);
  });

  it('preserves CRLF bytes outside a replaced declaration and preserves canonical CRLF input', () => {
    const stale = 'Overview\r\nPlan: .docs/plans/stale.md\r\nClosing note\r\n';
    const canonical = 'Overview\r\nPlan: .docs/plans/feature.md\r\nClosing note\r\n';

    expect(upsertShipmentPlanDeclaration(stale, 'feature')).toBe(canonical);
    expect(upsertShipmentPlanDeclaration(canonical, 'feature')).toBe(canonical);
  });
});
