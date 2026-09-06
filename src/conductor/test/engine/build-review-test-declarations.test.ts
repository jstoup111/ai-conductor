import { describe, expect, it } from 'vitest';
import {
  analyzeTestDeclarations,
  compareTestDeclarations,
  type TestDeclarationSource,
} from '../../src/engine/build-review-test-declarations.js';

function source(fileName: string, text: string): TestDeclarationSource {
  return { fileName, bytes: Buffer.from(text, 'utf8') };
}

describe('build-review test declarations', () => {
  it('returns only added and structurally modified declarations, not unchanged siblings', () => {
    const base = source('test/calculator.test.ts', `
      describe('calculator', () => {
        it('keeps an unchanged sibling', () => { expect(1 + 1).toBe(2); });
        test('changes its arguments', { timeout: 10 }, () => { expect(2).toBe(2); });
        it('same title', () => { expect('first').toBe('first'); });
        it('same title', () => { expect('second').toBe('second'); });
      });
    `);
    const head = source('test/calculator.test.ts', `
      describe('calculator', () => {
        it('keeps an unchanged sibling', () => { expect(1 + 1).toBe(2); });
        test('changes its arguments', { timeout: 20 }, () => { expect(2).toBe(2); });
        it('same title', () => { expect('first').toBe('first'); });
        it('same title', () => { expect('second').toBe('changed'); });
        specify('is newly added', () => { expect(true).toBe(true); });
      });
    `);

    const compared = compareTestDeclarations(base, head);

    expect(compared).toMatchObject({ kind: 'compared', uncertain: [] });
    if (compared.kind !== 'compared') throw new Error('expected supported comparison');
    expect(compared.changed.map((declaration) => ({
      titleChain: declaration.titleChain,
      change: declaration.change,
      occurrence: declaration.occurrence,
    }))).toEqual([
      { titleChain: ['calculator', 'changes its arguments'], change: 'modified', occurrence: 0 },
      { titleChain: ['calculator', 'same title'], change: 'modified', occurrence: 1 },
      { titleChain: ['calculator', 'is newly added'], change: 'added', occurrence: 0 },
    ]);
  });

  it('recognizes literal Vitest modifiers and syntax-proven aliases without running the source', () => {
    const analysis = analyzeTestDeclarations(source('test/aliases.test.ts', `
      import { describe as suite, it as caseIt } from 'vitest';
      const checked = caseIt;
      suite.skip('modifiers', () => {
        checked.concurrent.only('works', async () => { expect(true).toBe(true); });
      });
    `));

    expect(analysis).toMatchObject({ kind: 'supported', diagnostics: [] });
    if (analysis.kind !== 'supported') throw new Error('expected supported analysis');
    expect(analysis.declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'suite', titleChain: ['modifiers'], modifierChain: ['skip'] }),
      expect.objectContaining({ kind: 'test', titleChain: ['modifiers', 'works'], modifierChain: ['concurrent', 'only'] }),
    ]));
  });

  it('keeps parameterized declarations as groups and reports unsupported wrappers or parser diagnostics as uncertainty', () => {
    const parameterized = analyzeTestDeclarations(source('test/rows.test.ts', `
      test.each([['one'], ['two']])('row %s', (value) => { expect(value).toBeTruthy(); });
    `));
    expect(parameterized).toMatchObject({ kind: 'supported', diagnostics: [] });
    if (parameterized.kind !== 'supported') throw new Error('expected parameterized group');
    expect(parameterized.declarations).toEqual([
      expect.objectContaining({ kind: 'group', titleChain: ['row %s'], modifierChain: ['each'] }),
    ]);

    const wrapped = analyzeTestDeclarations(source('test/wrapped.test.ts', `
      withEnvironment(it)('wrapped declaration', () => {});
    `));
    expect(wrapped).toMatchObject({
      kind: 'uncertain',
      diagnostics: [expect.objectContaining({ reason: 'unsupported-declaration-wrapper' })],
    });

    const malformed = analyzeTestDeclarations(source('test/malformed.test.ts', "it('broken', () => {"));
    expect(malformed).toMatchObject({
      kind: 'uncertain',
      diagnostics: expect.arrayContaining([expect.objectContaining({ reason: 'syntax-diagnostic' })]),
    });

    const dynamic = analyzeTestDeclarations(source('test/dynamic.test.ts', 'it(titleFromFixture, () => {});'));
    expect(dynamic).toMatchObject({
      kind: 'uncertain',
      diagnostics: [expect.objectContaining({ reason: 'nonliteral-declaration-title' })],
    });
  });

  it('keeps duplicate changed occurrences uncertain when syntax cannot establish a correspondence', () => {
    const base = source('test/duplicates.test.ts', `
      it('same title', () => { expect('first').toBe('first'); });
      it('same title', () => { expect('second').toBe('second'); });
    `);
    const head = source('test/duplicates.test.ts', `
      it('same title', () => { expect('first').toBe('changed'); });
      it('same title', () => { expect('second').toBe('changed'); });
    `);

    expect(compareTestDeclarations(base, head)).toMatchObject({
      kind: 'uncertain', changed: [],
      uncertain: [
        expect.objectContaining({ reason: 'uncertain-correspondence' }),
        expect.objectContaining({ reason: 'uncertain-correspondence' }),
      ],
    });
  });

  it('ignores formatting trivia but retains comment-marker semantics when comparing declarations', () => {
    const base = source('test/markers.test.ts', `
      describe('marked', () => {
        // Covers: story-1
        it('same title', () => { expect(true).toBe(true); });
      });
    `);
    const formatted = source('test/markers.test.ts', `describe( 'marked' , () => {
      // Covers: story-1
      it( 'same title' , () => {
        expect(true).toBe(true)
      } );
    });`);
    const changedMarker = source('test/markers.test.ts', `
      describe('marked', () => {
        // Covers: story-2
        it('same title', () => { expect(true).toBe(true); });
      });
    `);

    expect(compareTestDeclarations(base, formatted)).toMatchObject({ kind: 'compared', changed: [], uncertain: [] });
    expect(compareTestDeclarations(base, changedMarker)).toMatchObject({
      kind: 'compared',
      changed: [expect.objectContaining({ titleChain: ['marked', 'same title'], change: 'modified' })],
      uncertain: [],
    });
  });
});
