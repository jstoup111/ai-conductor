/**
 * Acceptance specs for
 * .docs/stories/off-tag-checkout-reports-up-to-date-forever-tagged.md (#1437).
 *
 * These specs drive the real `bin/update` and `bin/conduct --update` entry
 * points against local Git repositories. The config CLI and migration command
 * are faithful process-boundary fakes; no network or third-party service is
 * reached.
 *
 * Story-flow classification:
 * - Story 1: unit-covered (one resolver operation; plan Tasks 1-2).
 * - Stories 2-8: acceptance-covered (check, decide, report, and persist).
 * - Story 9: unit-covered (one installer identity operation; plan Task 11).
 * - Story 10: acceptance-covered (both public entry points must agree).
 *
 * Production entry points covered: bin/update and bin/conduct --update.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_UPDATE = join(REPO_ROOT, 'bin', 'update');
const REAL_CONDUCT = join(REPO_ROOT, 'bin', 'conduct');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');
const REAL_COMMON = join(REPO_ROOT, 'bin', 'lib', 'harness-common.sh');

interface CommandResult {
  exitCode: number;
  output: string;
}

interface HarnessFixture {
  root: string;
  update: string;
  conduct: string;
  remote: string;
}

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'off-tag-update-acceptance-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function command(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {},
): Promise<CommandResult> {
  const result = await execa(executable, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    reject: false,
    timeout: 10_000,
    all: true,
  });
  return {
    exitCode: result.exitCode ?? -1,
    output: String(result.all ?? ''),
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await command('git', args, { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.output}`);
  }
  return result.output.trim();
}

async function makeHarness(name: string): Promise<HarnessFixture> {
  const root = join(scratch, name);
  const bin = join(root, 'bin');
  const lib = join(bin, 'lib');
  const remote = join(scratch, `${name}-origin.git`);
  const update = join(bin, 'update');
  const conduct = join(bin, 'conduct');

  await mkdir(lib, { recursive: true });
  await copyFile(REAL_UPDATE, update);
  await copyFile(REAL_CONDUCT, conduct);
  await copyFile(REAL_COMMON, join(lib, 'harness-common.sh'));
  await chmod(update, 0o755);
  await chmod(conduct, 0o755);

  await symlink(REAL_CONDUCT_TS, join(bin, 'conduct-ts'));

  await writeFile(join(bin, 'migrate'), '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  await chmod(join(bin, 'migrate'), 0o755);
  await writeFile(
    join(root, 'CHANGELOG.md'),
    '# Changelog\n\n## [Unreleased]\n\n## [0.4.0]\n\n- release 0.4.0\n\n## [0.3.0]\n\n- release 0.3.0\n',
    'utf8',
  );
  await writeFile(join(root, 'VERSION'), '9.9.9\n', 'utf8');

  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'Acceptance Test');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-q', '-m', 'initial release');
  await git(scratch, 'init', '-q', '--bare', remote);
  await git(root, 'remote', 'add', 'origin', remote);

  return { root, update, conduct, remote };
}

async function commit(root: string, message: string): Promise<string> {
  await git(root, 'commit', '-q', '--allow-empty', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

async function publish(fixture: HarnessFixture): Promise<void> {
  await git(fixture.root, 'push', '-q', '--force', '--tags', 'origin', 'HEAD:refs/heads/main');
}

async function makeHome(
  name: string,
  fields: Record<string, string> = {},
): Promise<string> {
  const home = join(scratch, `home-${name}`);
  const config = join(home, '.ai-conductor', 'config.yml');
  await mkdir(dirname(config), { recursive: true });
  const body = Object.entries(fields)
    .map(([key, value]) => `  ${key}: ${value}`)
    .join('\n');
  await writeFile(config, `conductor:\n${body}${body ? '\n' : ''}`, 'utf8');
  return home;
}

async function runEntry(
  fixture: HarnessFixture,
  home: string,
  entry: 'update' | 'conduct' = 'update',
): Promise<CommandResult> {
  const executable = entry === 'update' ? fixture.update : fixture.conduct;
  const args = entry === 'update' ? [] : ['--update'];
  return command(executable, args, {
    cwd: fixture.root,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${join(fixture.root, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    },
    input: '',
  });
}

async function configValue(home: string, key: string): Promise<string> {
  const raw = await readFile(join(home, '.ai-conductor', 'config.yml'), 'utf8');
  const line = raw.split('\n').find((candidate) => candidate.startsWith(`  ${key}:`));
  return line?.slice(line.indexOf(':') + 1).trim() ?? '';
}

function identityLines(output: string): string[] {
  return output.split('\n').filter((line) => /identity/i.test(line));
}

describe('off-tag checkout reports its real update identity (#1437)', () => {
  it('reports drift past the newest release, persists the baseline, and leaves HEAD unchanged', async () => {
    const fixture = await makeHarness('past-newest');
    await git(fixture.root, 'tag', 'v0.4.0');
    await commit(fixture.root, 'post-release one');
    await commit(fixture.root, 'post-release two');
    await publish(fixture);
    const before = await git(fixture.root, 'rev-parse', 'HEAD');
    const home = await makeHome('past-newest', {
      update_channel: 'tagged',
      current_version: 'v0.4.0',
    });

    const result = await runEntry(fixture, home);

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/identity.*v0\.4\.0\+2.*checkout/i);
    expect(result.output).toMatch(/2 commits past v0\.4\.0.*no newer release/i);
    expect(result.output).not.toMatch(/update available|update to/i);
    expect(result.output).not.toMatch(/up to date(?!.*commits past)/i);
    expect(identityLines(result.output)).toHaveLength(1);
    expect(await configValue(home, 'current_version')).toBe('v0.4.0');
    expect(await configValue(home, 'last_checked_at')).not.toBe('');
    expect(await git(fixture.root, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('reports an off-tag identity, offers a newer release without a TTY, and keeps the checkout unchanged', async () => {
    const fixture = await makeHarness('past-with-newer');
    await git(fixture.root, 'tag', 'v0.3.0');
    const offTag = await commit(fixture.root, 'between releases');
    await commit(fixture.root, 'next release');
    await git(fixture.root, 'tag', 'v0.4.0');
    await publish(fixture);
    await git(fixture.root, 'checkout', '-q', offTag);
    const home = await makeHome('past-with-newer', { update_channel: 'tagged' });

    const result = await runEntry(fixture, home);

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/identity.*v0\.3\.0\+1.*checkout/i);
    expect(result.output).toMatch(/v0\.3\.0 → v0\.4\.0/);
    expect(result.output).toMatch(/git checkout.*v0\.4\.0.*bin\/migrate/is);
    expect(result.output).not.toMatch(/Update to .*\[y\/n\]/i);
    expect(await configValue(home, 'current_version')).toBe('v0.3.0');
    expect(await git(fixture.root, 'rev-parse', 'HEAD')).toBe(offTag);
  });

  it('reports an exact newest tag as up to date and ignores VERSION and a contradictory record', async () => {
    const fixture = await makeHarness('exact-tag');
    await git(fixture.root, 'tag', 'v0.3.0');
    await commit(fixture.root, 'next release');
    await git(fixture.root, 'tag', 'v0.4.0');
    await publish(fixture);
    const home = await makeHome('exact-tag', {
      update_channel: 'tagged',
      current_version: 'v9.9.9',
    });

    const result = await runEntry(fixture, home);

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/identity.*v0\.4\.0.*checkout/i);
    expect(result.output).toMatch(/up to date/i);
    expect(result.output).not.toMatch(/commits past|update available|v9\.9\.9/);
    expect(identityLines(result.output)).toHaveLength(1);
    expect(await configValue(home, 'current_version')).toBe('v0.4.0');
  });

  it('declines to guess when release tags exist but none is reachable from HEAD', async () => {
    const fixture = await makeHarness('unreachable-tag');
    await git(fixture.root, 'tag', 'v0.4.0');
    await publish(fixture);
    await git(fixture.root, 'checkout', '-q', '--orphan', 'orphan');
    await git(fixture.root, 'commit', '-q', '--allow-empty', '-m', 'orphan checkout');
    const emptyHome = await makeHome('unreachable-tag-empty', {
      update_channel: 'tagged',
    });
    const recordedHome = await makeHome('unreachable-tag-recorded', {
      update_channel: 'tagged',
      current_version: 'v0.3.0',
    });

    const emptyResult = await runEntry(fixture, emptyHome);
    const recordedResult = await runEntry(fixture, recordedHome);

    expect(emptyResult.exitCode).toBe(0);
    expect(emptyResult.output).toMatch(/identity.*unverifiable/i);
    expect(emptyResult.output).not.toMatch(/update available|update to/i);
    expect(identityLines(emptyResult.output)).toHaveLength(1);
    expect(await configValue(emptyHome, 'current_version')).toBe('');

    expect(recordedResult.exitCode).toBe(0);
    expect(recordedResult.output).toMatch(/identity.*unverifiable/i);
    expect(recordedResult.output).not.toMatch(/update available|update to/i);
    expect(await configValue(recordedHome, 'current_version')).toBe('v0.3.0');
  });

  it('does not let malformed persisted configuration change a determinable checkout decision', async () => {
    const fixture = await makeHarness('malformed-config');
    await git(fixture.root, 'tag', 'v0.4.0');
    await commit(fixture.root, 'post-release');
    await publish(fixture);
    const home = await makeHome('malformed-config');
    await writeFile(
      join(home, '.ai-conductor', 'config.yml'),
      'conductor:\n  update_channel: tagged\n  current_version: [\n',
      'utf8',
    );

    const result = await runEntry(fixture, home);

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/identity.*v0\.4\.0\+1.*checkout/i);
    expect(result.output).toMatch(/1 commits? past v0\.4\.0.*no newer release/i);
  });

  it('prints the main-channel identity even when the checkout is level with origin/main', async () => {
    const fixture = await makeHarness('main-level');
    await publish(fixture);
    const sha = (await git(fixture.root, 'rev-parse', '--short', 'HEAD')).trim();
    const home = await makeHome('main-level', { update_channel: 'main' });

    const result = await runEntry(fixture, home);

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(new RegExp(`identity.*main@${sha}.*main.*behind.*0`, 'i'));
    expect(result.output).not.toMatch(/unverifiable|v\d+\.\d+\.\d+\+\d+/i);
    expect(result.output).not.toMatch(/update available|pull latest/i);
    expect(identityLines(result.output)).toHaveLength(1);
  });

  it('keeps bin/update and bin/conduct on the same post-release decision', async () => {
    const fixture = await makeHarness('entry-parity');
    await git(fixture.root, 'tag', 'v0.4.0');
    await commit(fixture.root, 'post-release');
    await publish(fixture);
    const updateHome = await makeHome('entry-parity-update', {
      update_channel: 'tagged',
    });
    const conductHome = await makeHome('entry-parity-conduct', {
      update_channel: 'tagged',
    });

    const update = await runEntry(fixture, updateHome, 'update');
    const conduct = await runEntry(fixture, conductHome, 'conduct');

    expect(update.exitCode).toBe(0);
    expect(conduct.exitCode).toBe(0);
    expect(update.output).toMatch(/identity.*v0\.4\.0\+1.*checkout/i);
    expect(conduct.output).toMatch(/identity.*v0\.4\.0\+1.*checkout/i);
    expect(update.output).toMatch(/1 commits? past v0\.4\.0.*no newer release/i);
    expect(conduct.output).toMatch(/1 commits? past v0\.4\.0.*no newer release/i);
  });
});
