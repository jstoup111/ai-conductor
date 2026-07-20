import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeIssueOnImplementationMerge } from '../src/engine/engineer/issue-ref.js';
import { enrollObservation } from '../src/engine/observation-sweep.js';
import { readObservationDeclaration } from '../src/engine/observation-marker.js';

/**
 * Tests for adr-2026-07-10-observed-close-watch-registry production wiring
 * gap: daemon-cli.ts's post-`conductor.run()` call site must (a) read the
 * spec's observation declaration, (b) pass it plus an `enroll` callback into
 * `closeIssueOnImplementationMerge`, and (c) enroll into the PRIMARY repo's
 * `.daemon/observation-watch.jsonl` (projectRoot), never the build worktree.
 *
 * `observed-close-ship-time-trailer.acceptance.test.ts` already covers
 * `closeIssueOnImplementationMerge` in isolation (declaration/enroll supplied
 * directly). This file closes the gap by exercising the SAME wiring shape
 * daemon-cli.ts's runOneFeature uses at its real call site: build
 * `declaration` via `readObservationDeclaration(wt.path, slug, ...)`, wire
 * `enroll` to `enrollObservation(projectRoot, entry, log)`, and call
 * `closeIssueOnImplementationMerge`. Mirrors the "simulate the real wiring
 * inline, with real fs/deps" pattern used by
 * test/daemon-cli-watch-wiring.test.ts, since daemon-cli.ts's runOneFeature
 * closure is not independently exported/testable.
 */
describe('daemon-cli — closeIssueOnImplementationMerge production wiring', () => {
  let projectRoot: string;
  let wtPath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'daemon-cli-primary-'));
    wtPath = await mkdtemp(join(tmpdir(), 'daemon-cli-worktree-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(wtPath, { recursive: true, force: true });
  });

  async function runWiring(slug: string, prUrl: string, sourceRef: string) {
    const prBodies: Record<string, string> = { [prUrl]: '' };
    const gh = async (args: string[], _opts: { cwd: string }) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ body: prBodies[prUrl] }) };
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        const bodyIdx = args.indexOf('--body');
        prBodies[prUrl] = args[bodyIdx + 1];
        return { stdout: '' };
      }
      return { stdout: '' };
    };
    const logs: string[] = [];
    const log = (m: string) => logs.push(m);

    // Exactly the shape of the fixed daemon-cli.ts call site.
    const declaration = await readObservationDeclaration(wtPath, slug, { warn: log });
    await closeIssueOnImplementationMerge({
      gh,
      sourceRef,
      prUrl,
      cwd: wtPath,
      slug,
      declaration,
      enroll: (entry) => enrollObservation(projectRoot, entry, log),
      log,
    });

    return { prBody: prBodies[prUrl], logs };
  }

  it('watched marker present: uses Refs (never Closes) and enrolls into projectRoot/.daemon/observation-watch.jsonl', async () => {
    const slug = 'watched-fix';
    const sourceRef = 'acme/widgets#42';
    const prUrl = 'https://github.com/acme/widgets/pull/7';

    await mkdir(join(wtPath, '.docs', 'observation'), { recursive: true });
    await writeFile(
      join(wtPath, '.docs', 'observation', `${slug}.md`),
      ['Signature: widget-fix-applied', 'Surface: daemon-log', 'Window-days: 14', ''].join('\n'),
      'utf-8',
    );

    const { prBody } = await runWiring(slug, prUrl, sourceRef);

    expect(prBody).toContain(`Refs ${sourceRef}`);
    expect(prBody).not.toContain('Closes');

    const registryPath = join(projectRoot, '.daemon', 'observation-watch.jsonl');
    const raw = await readFile(registryPath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      v: 1,
      sourceRef,
      prUrl,
      slug,
      signature: 'widget-fix-applied',
      isRegex: false,
      windowDays: 14,
    });

    // Registry must live under the PRIMARY repo (projectRoot), never the
    // build worktree.
    await expect(readFile(join(wtPath, '.daemon', 'observation-watch.jsonl'), 'utf-8')).rejects.toThrow();
  });

  it('no marker present: byte-identical legacy behavior — Closes, no registry file created', async () => {
    const slug = 'legacy-fix';
    const sourceRef = 'acme/widgets#99';
    const prUrl = 'https://github.com/acme/widgets/pull/9';

    const { prBody } = await runWiring(slug, prUrl, sourceRef);

    expect(prBody).toContain(`Closes ${sourceRef}`);
    expect(prBody).not.toContain('Refs');

    await expect(
      readFile(join(projectRoot, '.daemon', 'observation-watch.jsonl'), 'utf-8'),
    ).rejects.toThrow();
  });
});
