import { describe, expect, it } from 'vitest';
import {
  parseWiredIntoLine,
  serializeWiredInto,
  resolveWiredInto,
  combineWiredInto,
  type WiredIntoParseResult,
} from '../src/engine/wired-into';

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

  it('parses "none (no new production surface)" as no_new_surface', () => {
    expect(
      parseWiredIntoLine('**Wired-into:** none (no new production surface)'),
    ).toEqual({ kind: 'no_new_surface' });
  });

  it('parses "none (inert until owner/repo#number)" as an inert issue ref', () => {
    expect(
      parseWiredIntoLine(
        '**Wired-into:** none (inert until jstoup111/ai-conductor#999)',
      ),
    ).toEqual({
      kind: 'inert',
      ref: { form: 'issue', owner: 'jstoup111', repo: 'ai-conductor', number: 999 },
    });
  });

  it('parses "none (inert until path)" as an inert path ref', () => {
    expect(
      parseWiredIntoLine(
        '**Wired-into:** none (inert until path/to/some-file.ts)',
      ),
    ).toEqual({
      kind: 'inert',
      ref: { form: 'path', path: 'path/to/some-file.ts' },
    });
  });

  it('parses free text that matches none of the accepted forms as malformed', () => {
    const result = parseWiredIntoLine('**Wired-into:** fix it later');
    expect(result.kind).toBe('malformed');
    if (result.kind !== 'malformed') throw new Error('unreachable');
    expect(result.message).toContain('fix it later');
    expect(result.message).toContain('declared site(s)');
    expect(result.message).toContain('same as Task N');
    expect(result.message).toContain('none (no new production surface)');
    expect(result.message).toContain('none (inert until <ref>)');
  });

  it('parses "none (inert until )" with an empty ref as malformed', () => {
    const result = parseWiredIntoLine('**Wired-into:** none (inert until )');
    expect(result.kind).toBe('malformed');
  });
});

describe('serializeWiredInto round-trip', () => {
  const fixtures: string[] = [
    '**Wired-into:** src/engine/conductor.ts#advanceTail',
    '**Wired-into:** src/a.ts#foo, src/b.ts#bar',
    '**Wired-into:** none (no new production surface)',
    '**Wired-into:** none (inert until jstoup111/ai-conductor#999)',
    '**Wired-into:** none (inert until path/to/some-file.ts)',
  ];

  for (const line of fixtures) {
    it(`round-trips: ${line}`, () => {
      const parsed = parseWiredIntoLine(line);
      const reparsed = parseWiredIntoLine(serializeWiredInto(parsed));
      expect(reparsed).toEqual(parsed);
    });
  }
});

describe('resolveWiredInto (inheritance)', () => {
  it('resolves "same as Task N" against a task map', () => {
    const taskMap = new Map<string, WiredIntoParseResult>([
      ['3', { kind: 'declared', sites: [{ path: 'src/a.ts', symbol: 'foo' }] }],
    ]);
    const result = resolveWiredInto('**Wired-into:** same as Task 3', taskMap);
    expect(result).toEqual({
      kind: 'declared',
      sites: [{ path: 'src/a.ts', symbol: 'foo' }],
    });
  });

  it('errors with a named message when the inheritance target is absent', () => {
    const taskMap = new Map<string, WiredIntoParseResult>();
    const result = resolveWiredInto('**Wired-into:** same as Task 99', taskMap);
    expect(result.kind).toBe('malformed');
    if (result.kind !== 'malformed') throw new Error('unreachable');
    expect(result.message).toContain('inheritance target Task 99 not found');
  });

  it('falls through to normal parsing for non-inheritance lines', () => {
    const taskMap = new Map<string, WiredIntoParseResult>();
    const result = resolveWiredInto(
      '**Wired-into:** src/a.ts#foo',
      taskMap,
    );
    expect(result).toEqual({
      kind: 'declared',
      sites: [{ path: 'src/a.ts', symbol: 'foo' }],
    });
  });
});

describe('combineWiredInto (multi-line accumulation)', () => {
  it('accumulates two declared results into one, preserving order', () => {
    const first: WiredIntoParseResult = {
      kind: 'declared',
      sites: [{ path: 'src/a.ts', symbol: 'foo' }],
    };
    const second: WiredIntoParseResult = {
      kind: 'declared',
      sites: [{ path: 'src/b.ts', symbol: 'bar' }],
    };
    expect(combineWiredInto(first, second)).toEqual({
      kind: 'declared',
      sites: [
        { path: 'src/a.ts', symbol: 'foo' },
        { path: 'src/b.ts', symbol: 'bar' },
      ],
    });
  });

  it('propagates a malformed result from either side', () => {
    const declared: WiredIntoParseResult = { kind: 'declared', sites: [] };
    const bad: WiredIntoParseResult = { kind: 'malformed', message: 'bad' };
    expect(combineWiredInto(declared, bad)).toEqual(bad);
    expect(combineWiredInto(bad, declared)).toEqual(bad);
  });
});
