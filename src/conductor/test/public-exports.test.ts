// Covers: task:14
import { describe, expect, it } from 'vitest';
import * as mainEntry from '../src/index.js';
import * as releaseActions from '../src/engine/self-host/release-actions.js';
import recordedMainExports from './public-exports.json';

const releaseActionNames = [
  'classifyReleasePublication',
  'collectReleaseCandidates',
  'renderReleaseCandidate',
  'renderReleaseCandidateAudit',
  'runReleaseMetadataCheckAction',
  'runReleasePrAction',
  'runReleasePublisherAction',
] as const;

export function assertRecordedExports(
  actual: readonly string[],
  recorded: readonly string[],
): void {
  const extra = actual.filter((name) => !recorded.includes(name));
  if (extra.length > 0) {
    throw new Error(`unexpected public export: ${extra.join(', ')}`);
  }

  const missing = recorded.filter((name) => !actual.includes(name));
  if (missing.length > 0) {
    throw new Error(`missing public export: ${missing.join(', ')}`);
  }
}

describe('public package exports', () => {
  it('matches the committed main-entry export list', () => {
    expect(() => assertRecordedExports(Object.keys(mainEntry).sort(), recordedMainExports))
      .not.toThrow();
  });

  it('reports an unexpected synthetic export by name', () => {
    expect(() => assertRecordedExports(['expected', 'synthetic-extra'], ['expected']))
      .toThrow('synthetic-extra');
  });

  it('records none of the release actions in the main-entry list', () => {
    expect(recordedMainExports.filter((name) => releaseActionNames.includes(name as never)))
      .toEqual([]);
  });

  it('exposes the seven release actions from their own entry', () => {
    expect(Object.keys(releaseActions).sort()).toEqual(releaseActionNames);
  });

  it('exports callable release actions', () => {
    expect(releaseActionNames.every((name) => typeof releaseActions[name] === 'function'))
      .toBe(true);
  });
});
