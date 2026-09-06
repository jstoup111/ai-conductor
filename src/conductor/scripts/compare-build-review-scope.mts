#!/usr/bin/env npx tsx
/**
 * Portable #2231 comparison evidence.  This intentionally uses fixture labels
 * rather than the retained Git object ids: the ids are provenance, not a CI
 * dependency.  The current side runs the production frozen-input assembler
 * and projection builder with a scripted Git process and a fake dispatcher.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assembleBuildReviewInputs } from '../src/engine/build-review-inputs.js';
import { parseBuildReviewLapId } from '../src/engine/build-review-domain.js';
import {
  canonicalJson,
  deriveBuildReviewRubricProjections,
  type BuildReviewProjectionJson,
} from '../src/engine/build-review-projections.js';
import { analyzeTestDeclarations } from '../src/engine/build-review-test-declarations.js';
import type { FullSuiteInspectionResult } from '../src/engine/full-suite-verifier.js';
import type { GitResult, GitRunner } from '../src/engine/rebase.js';

const fixtureUrl = new URL('../test/fixtures/build-review-scope/portable-2231.json', import.meta.url);
const fixtureBase = 'portable-fixture-base';
const fixtureHead = 'portable-fixture-head';

interface ChangedBodyFixture {
  readonly title: string;
  readonly marker?: string;
  readonly baseMarker?: string;
  readonly disposition: string;
}

interface Fixture {
  readonly provenance: { readonly issue: string; readonly base: string; readonly head: string };
  readonly feature: {
    readonly planPath: string;
    readonly storiesPath: string;
    readonly testPath: string;
    readonly unchangedSiblingCount: number;
  };
  readonly criteria: readonly string[];
  readonly changedBodies: readonly ChangedBodyFixture[];
  readonly sharedEvidence: {
    readonly suite: string;
    readonly marker: string;
    readonly baseSetup: string;
    readonly headSetup: string;
    readonly retainedBodies: readonly string[];
  };
}

export interface BuildReviewScopeComparison {
  readonly provenance: Fixture['provenance'];
  readonly legacy: { readonly projectedTitles: number };
  readonly scoped: { readonly changedBodies: number; readonly dispositions: Readonly<Record<string, string>> };
  readonly counts: {
    readonly sourceReads: number;
    readonly declarations: number;
    readonly targets: number;
    readonly candidates: number;
    readonly sharedSources: number;
    readonly ambiguousCandidates: number;
  };
  /** Bytes of the two serialized reviewer projections, not provider-token measurements. */
  readonly projectionBytes: { readonly legacy: number; readonly scoped: number };
  /** Calls made to this entry point's fake dispatcher; ordinary runs use no real provider. */
  readonly dispatchCounts: { readonly legacy: number; readonly scoped: number; readonly realProviders: 0 };
  /** Observation only: no unit-test performance threshold is implied. */
  readonly elapsedAnalysisMs: number;
  readonly retainedEvidence: { readonly shared: boolean; readonly ambiguous: boolean };
}

function markerLine(marker: string | undefined): string[] {
  return marker === undefined ? [] : [`// Covers: ${marker}`];
}

function testLine(title: string, body: string): string {
  return `it(${JSON.stringify(title)}, () => { expect(${JSON.stringify(body)}).toBe('changed'); });`;
}

function fixtureSources(fixture: Fixture): { readonly base: string; readonly head: string } {
  const header = fixture.changedBodies.find((entry) => entry.title === 'header-associated body');
  if (!header) throw new Error('portable fixture must retain a file-header ambiguity');

  const render = (side: 'base' | 'head') => {
    const lines = [`// Covers: ${header.marker ?? 'S9.99'}`, testLine(header.title, side === 'base' ? 'base' : 'head')];
    for (const body of fixture.changedBodies) {
      if (body === header) continue;
      lines.push(...markerLine(side === 'base' ? body.baseMarker ?? body.marker : body.marker));
      lines.push(testLine(body.title, side === 'base' ? 'base' : 'head'));
    }
    lines.push(
      `// Covers: ${fixture.sharedEvidence.marker}`,
      `describe(${JSON.stringify(fixture.sharedEvidence.suite)}, () => {`,
      `  beforeEach(() => { seed(${JSON.stringify(side === 'base' ? fixture.sharedEvidence.baseSetup : fixture.sharedEvidence.headSetup)}); });`,
      ...fixture.sharedEvidence.retainedBodies.map((title) => `  ${testLine(title, 'stable')}`),
      '});',
      ...Array.from({ length: fixture.feature.unchangedSiblingCount }, (_, index) =>
        testLine(`unchanged sibling ${index + 1}`, 'stable'),
      ),
      '',
    );
    return lines.join('\n');
  };
  return { base: render('base'), head: render('head') };
}

function storiesSource(criteria: readonly string[]): string {
  return [
    '## Story 9: Portable scope comparison',
    '#### Happy Path',
    ...criteria.map((criterion) => `- Given ${criterion}, when scope runs, then it remains pinned`),
    '',
    'FR-1',
  ].join('\n');
}

function planSource(storiesPath: string): string {
  return [
    `**Stories:** ${storiesPath}`,
    '',
    '### Task 18: Portable comparison',
    '**Files:** test/portable-2231.test.ts',
    '',
  ].join('\n');
}

function fakeGit(blobs: ReadonlyMap<string, string>): { readonly git: GitRunner; readonly sourceReads: () => number } {
  let reads = 0;
  const git: GitRunner = async (args) => {
    if (args[0] === 'remote') return { exitCode: 0, stdout: 'origin\n', stderr: '' };
    if (args[0] === 'symbolic-ref' && args[1] === '--short') return { exitCode: 0, stdout: 'feature\n', stderr: '' };
    if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
    if (args[0] === 'rev-parse' && args[1] === 'refs/remotes/origin/main') return { exitCode: 0, stdout: `${fixtureBase}\n`, stderr: '' };
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { exitCode: 0, stdout: `${fixtureHead}\n`, stderr: '' };
    if (args[0] === 'ls-remote') return { exitCode: 0, stdout: `${fixtureBase}\trefs/heads/main\n`, stderr: '' };
    if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${fixtureBase}\n`, stderr: '' };
    if (args[0] === 'diff' && args.includes('--name-status')) {
      const path = [...blobs.keys()].find((key) => key.startsWith(`${fixtureHead}:test/`))?.slice(`${fixtureHead}:`.length);
      return { exitCode: 0, stdout: path ? `M\0${path}\0` : '', stderr: '' };
    }
    if (args[0] === 'diff') {
      return {
        exitCode: 0,
        stdout: [
          'diff --git a/test/portable-2231.test.ts b/test/portable-2231.test.ts',
          '--- a/test/portable-2231.test.ts',
          '+++ b/test/portable-2231.test.ts',
          '@@ -1 +1 @@',
          '-base',
          '+head',
          '',
        ].join('\n'),
        stderr: '',
      };
    }
    if (args[0] === 'show') {
      reads += 1;
      const value = blobs.get(args[1] ?? '');
      return value === undefined
        ? { exitCode: 1, stdout: '', stderr: 'fixture blob absent' }
        : { exitCode: 0, stdout: value, stderr: '' };
    }
    return { exitCode: 1, stdout: '', stderr: `unexpected fixture command: ${args.join(' ')}` };
  };
  return { git, sourceReads: () => reads };
}

class FakeDispatcher {
  legacy = 0;
  scoped = 0;

  dispatch(kind: 'legacy' | 'scoped', _projection: BuildReviewProjectionJson): void {
    if (kind === 'legacy') this.legacy += 1;
    else this.scoped += 1;
  }
}

function lastTitle(declaration: { readonly titleChain: readonly string[] }): string {
  return declaration.titleChain.at(-1) ?? '';
}

/** Runs the real frozen assembly and projection against only fixture-labelled blobs. */
export async function compareBuildReviewScope(): Promise<BuildReviewScopeComparison> {
  const startedAt = performance.now();
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf-8')) as Fixture;
  const sources = fixtureSources(fixture);
  const plan = planSource(fixture.feature.storiesPath);
  const blobs = new Map<string, string>([
    [`${fixtureBase}:${fixture.feature.planPath}`, plan],
    [`${fixtureHead}:${fixture.feature.planPath}`, plan],
    [`${fixtureHead}:${fixture.feature.storiesPath}`, storiesSource(fixture.criteria)],
    [`${fixtureBase}:${fixture.feature.testPath}`, sources.base],
    [`${fixtureHead}:${fixture.feature.testPath}`, sources.head],
  ]);
  const process = fakeGit(blobs);
  const inputs = await assembleBuildReviewInputs(process.git, `/portable/${fixture.feature.planPath}`, {
    inspectTestSuite: async () => ({
      status: 'CURRENT',
      evidence: {
        provenanceHeadSha: fixtureHead,
        outcome: 'PASS',
        reason: 'exit_zero',
        fingerprint: 'sha256:portable-fixture',
        startedAt: '2026-09-06T00:00:00.000Z',
        endedAt: '2026-09-06T00:00:00.000Z',
        durationMs: 0,
        stdout: '',
        stderr: '',
      },
    } as Extract<FullSuiteInspectionResult, { status: 'CURRENT' }>),
  });
  const scope = inputs.sourceSnapshot.testScope!;
  const legacyTitles = analyzeTestDeclarations({ fileName: fixture.feature.testPath, bytes: Buffer.from(sources.head) })
    .declarations
    .filter((declaration) => declaration.kind === 'test')
    .map((declaration) => declaration.titleChain.join(' > '));
  const legacyProjection = { changedTestTitles: legacyTitles } as unknown as BuildReviewProjectionJson;
  const testQuality = inputs.sourceSnapshot.testQuality!;
  const scopedProjection = deriveBuildReviewRubricProjections({
    lapId: parseBuildReviewLapId('portable-2231')!,
    inputs,
    testQuality: {
      runnerSelectors: testQuality.counterfactualFileSelectors,
      changedTestSelectors: testQuality.inScopeTests,
      unresolvedMarkers: testQuality.unresolvedMarkers,
      revertedProductionManifest: [],
      preflight: {
        classification: 'pass', exitCode: 0, runKind: 'exit-zero', ranSelectors: [], excerpt: '', output: { stdout: '', stderr: '' },
      } as never,
    },
  }).testQuality;
  const dispatcher = new FakeDispatcher();
  dispatcher.dispatch('legacy', legacyProjection);
  dispatcher.dispatch('scoped', scopedProjection as unknown as BuildReviewProjectionJson);

  const dispositions: Record<string, string> = {};
  for (const target of scope.targets) dispositions[lastTitle(target.declaration)] = 'target';
  for (const note of scope.notes) {
    if ('declaration' in note) dispositions[lastTitle(note.declaration)] = note.kind;
  }
  const changedTitles = new Set(fixture.changedBodies.map((body) => body.title));
  for (const candidate of scope.candidates) {
    if (candidate.declaration && changedTitles.has(lastTitle(candidate.declaration))) {
      dispositions[lastTitle(candidate.declaration)] = candidate.reasons[0] ?? 'candidate';
    }
  }

  return {
    provenance: fixture.provenance,
    legacy: { projectedTitles: legacyTitles.length },
    scoped: { changedBodies: scope.changedDeclarations.length, dispositions },
    counts: {
      sourceReads: process.sourceReads(),
      declarations: scope.changedDeclarations.length,
      targets: scope.targets.length,
      candidates: scope.candidates.length,
      sharedSources: scope.sharedSources.length,
      ambiguousCandidates: scope.candidates.filter((candidate) => candidate.reasons.includes('conflicting-associations')).length,
    },
    projectionBytes: {
      legacy: Buffer.byteLength(canonicalJson(legacyProjection)),
      scoped: Buffer.byteLength(canonicalJson(scopedProjection as unknown as BuildReviewProjectionJson)),
    },
    dispatchCounts: { legacy: dispatcher.legacy, scoped: dispatcher.scoped, realProviders: 0 },
    elapsedAnalysisMs: performance.now() - startedAt,
    retainedEvidence: {
      shared: scope.sharedSources.length > 0,
      ambiguous: scope.candidates.some((candidate) => candidate.reasons.includes('conflicting-associations')),
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  compareBuildReviewScope().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
