import { describe, expect, it } from 'vitest';
import { parseWiredIntoLine } from '../src/engine/wired-into';

describe('parseWiredIntoLine', () => {
  it('parses a single declared site', () => {
    expect(
      parseWiredIntoLine('**Wired-into:** src/engine/conductor.ts#advanceTail'),
    ).toEqual({
      kind: 'declared',
      sites: [{ path: 'src/engine/conductor.ts', symbol: 'advanceTail' }],
    });
  });

  it('parses multiple comma-separated sites in order', () => {
    expect(
      parseWiredIntoLine('**Wired-into:** src/a.ts#foo, src/b.ts#bar'),
    ).toEqual({
      kind: 'declared',
      sites: [
        { path: 'src/a.ts', symbol: 'foo' },
        { path: 'src/b.ts', symbol: 'bar' },
      ],
    });
  });

  it('accepts backticked values', () => {
    expect(
      parseWiredIntoLine('**Wired-into:** `src/a.ts#foo`'),
    ).toEqual({
      kind: 'declared',
      sites: [{ path: 'src/a.ts', symbol: 'foo' }],
    });
  });
});
