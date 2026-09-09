// Covers: task:1
// Unit coverage for the body composed before a spec PR is created. All file and
// git seams are injected: these tests must never read a checkout or spawn git.

import { describe, expect, it } from 'vitest';
import {
  buildSpecPrCreateArgs,
  composeSpecPrBody,
  DEFAULT_SPEC_RELEASE_BLOCK,
} from '../../../src/engine/engineer/release-metadata-inject.js';
import { parseReleaseDisposition } from '../../../src/engine/release-metadata.js';
import type { GitRunner } from '../../../src/engine/pr-labels.js';

const optInTemplate = '## Release metadata\n\nRelease-Disposition: no-note\n';

describe('composeSpecPrBody', () => {
  const validNoNote = 'Intro\r\n\r\nRelease-Disposition: no-note\r\n';
  const validNote = [
    'Release-Disposition: note',
    'Release-Category: Fixed',
    'Release-Semver: patch',
    'Release-Note: Preserve exactly.',
  ].join('\n');

  it.each([
    { name: 'empty body', body: '', expected: DEFAULT_SPEC_RELEASE_BLOCK },
    {
      name: 'ordinary prose with trailing whitespace',
      body: 'Explain the spec.  \n\t',
      expected: `Explain the spec.\n\n${DEFAULT_SPEC_RELEASE_BLOCK}`,
    },
    { name: 'valid no-note declaration', body: validNoNote, expected: validNoNote },
    { name: 'valid note declaration', body: validNote, expected: validNote },
  ])('composes $name', ({ body, expected }) => {
    expect(composeSpecPrBody(body)).toBe(expected);
  });

  it('keeps the composed default parseable after a non-closing issue reference', () => {
    const body = `${composeSpecPrBody('') }\n\nRefs owner/repo#42`;

    expect(parseReleaseDisposition(body)).toEqual({ disposition: 'no-note' });
  });
});

describe('buildSpecPrCreateArgs', () => {
  function gitReturning(message: string): { git: GitRunner; calls: string[][] } {
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push([...args]);
      return { stdout: message };
    };
    return { git, calls };
  }

  it('returns one title and one parser-accepted body from the named branch tip', async () => {
    const { git, calls } = gitReturning('spec: compose disposition\n\nExplanation.\n');

    const args = await buildSpecPrCreateArgs({
      cwd: '/target',
      branch: 'spec/compose-disposition',
      git,
      readTemplate: async () => optInTemplate,
    });

    expect(calls).toEqual([['show', '-s', '--format=%B', 'spec/compose-disposition']]);
    expect(args).toHaveLength(4);
    expect(args.filter((arg) => arg === '--title')).toHaveLength(1);
    expect(args.filter((arg) => arg === '--body')).toHaveLength(1);
    expect(args[args.indexOf('--title') + 1]).toBe('spec: compose disposition');
    expect(parseReleaseDisposition(args[args.indexOf('--body') + 1]!)).toEqual({ disposition: 'no-note' });
  });

  it('returns no arguments without opt-in', async () => {
    const { git, calls } = gitReturning('subject\n');

    await expect(buildSpecPrCreateArgs({
      cwd: '/target',
      branch: 'spec/opted-out',
      git,
      readTemplate: async () => '## What\n',
    })).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it('returns no arguments rather than throwing when the git runner rejects', async () => {
    const git: GitRunner = async () => {
      throw new Error('git unavailable');
    };

    await expect(buildSpecPrCreateArgs({
      cwd: '/target',
      branch: 'spec/degraded-read',
      git,
      readTemplate: async () => optInTemplate,
    })).resolves.toEqual([]);
  });
});
