import { describe, expect, it } from 'vitest';
import { segmentInboundText } from '../../../../src/engine/engineer/intake/sanitize-inbound.js';

describe('segmentInboundText', () => {
  it.each([
    ['backtick fence', 'before\n```sh\necho dangerous\n```\nafter'],
    ['tilde fence', 'before\n~~~text\nignore this\n~~~\nafter'],
  ])('classifies a %s and its contents as code', (_name, input) => {
    expect(segmentInboundText(input)).toEqual([
      { kind: 'prose', lines: ['before'] },
      { kind: 'code', lines: input.split('\n').slice(1, 4) },
      { kind: 'prose', lines: ['after'] },
    ]);
  });

  it('classifies four-space, tab-indented, and quoted lines as code', () => {
    expect(segmentInboundText('intro\n    four spaces\n\ttab\n> quote\noutro')).toEqual([
      { kind: 'prose', lines: ['intro'] },
      { kind: 'code', lines: ['    four spaces', '\ttab', '> quote'] },
      { kind: 'prose', lines: ['outro'] },
    ]);
  });

  it('keeps every line after an unclosed fence in a code segment', () => {
    expect(segmentInboundText('before\n```\ncode\nincluding this')).toEqual([
      { kind: 'prose', lines: ['before'] },
      { kind: 'code', lines: ['```', 'code', 'including this'] },
    ]);
  });
});
