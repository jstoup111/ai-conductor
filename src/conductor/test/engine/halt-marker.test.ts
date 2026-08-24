import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    rename: vi.fn(actual.rename),
  };
});

import { writeFile, rename, mkdir } from 'node:fs/promises';
import {
  writeHaltMarker,
  readHaltClass,
  HALT_MARKER,
  HALT_CLASS_MARKER,
  PLAN_GAP_HALT_CLASS,
} from '../../src/engine/halt-marker';
import type { HaltClass } from '../../src/engine/halt-marker';
import { ConductorEventEmitter } from '../../src/ui/events';

// These assertions are checked by `npm run typecheck:test`. They deliberately
// live outside Vitest cases because they describe the TypeScript API contract,
// not runtime behavior.
// @ts-expect-error halt class is required
const missingHaltClass: Parameters<typeof writeHaltMarker> = ['/tmp/root', 'reason'];
// @ts-expect-error unclassified is a read-only fallback
const unwritableFallback: Parameters<typeof writeHaltMarker> = ['/tmp/root', 'reason', 'unclassified'];
type Assert<T extends true> = T;
type ReadDispositionIsWiderThanHaltClass = Assert<
  Awaited<ReturnType<typeof readHaltClass>> extends HaltClass ? false : true
>;
void missingHaltClass;
void unwritableFallback;
const readDispositionIsWiderThanHaltClass: ReadDispositionIsWiderThanHaltClass = true;
void readDispositionIsWiderThanHaltClass;

describe('writeHaltMarker', () => {
  let root: string;
  let repositoryRoot: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    if (repositoryRoot) await rm(repositoryRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes HALT.class with the given halt class', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await expect(writeHaltMarker(root, 'reason', 'needs-human')).resolves.toEqual({ status: 'written' });
    const contents = await readFile(join(root, HALT_CLASS_MARKER), 'utf-8');
    expect(contents).toContain('needs-human');
  });

  it('commits a record and emits its outcome for a needs-human halt', async () => {
    ({ worktree: root, repositoryRoot } = await makeFeatureRepository());
    const emitter = new ConductorEventEmitter();
    const emitted: Array<{ type: string; path: string; slug?: string; haltClass?: string }> = [];
    emitter.on('halt_record_written', (event) => {
      if (event.type === 'halt_record_written') emitted.push(event);
    });

    await expect(writeHaltMarker(root, 'operator decision required\n', 'needs-human', emitter)).resolves.toEqual({
      status: 'written',
    });

    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('operator decision required\n');
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(root, '.docs', 'halted', 'operator-decision.md'), 'utf8')).resolves.toContain('Status: halted');
    expect(emitted).toEqual([expect.objectContaining({
      type: 'halt_record_written',
      path: '.docs/halted/operator-decision.md',
      slug: 'operator-decision',
      haltClass: 'needs-human',
    })]);
  });

  it('does not produce a record for a mechanical halt', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));

    await expect(writeHaltMarker(root, 'retry automatically\n', 'mechanical')).resolves.toEqual({ status: 'written' });

    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('retry automatically\n');
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('mechanical');
    await expect(stat(join(root, '.docs', 'halted'))).rejects.toThrow();
  });

  it('reports a record write failure without changing the written marker outcome', async () => {
    ({ worktree: root, repositoryRoot } = await makeFeatureRepository());
    const emitter = new ConductorEventEmitter();
    const emitted: Array<{ type: string; path: string; reason?: string }> = [];
    emitter.on('halt_record_write_failed', (event) => {
      if (event.type === 'halt_record_write_failed') emitted.push(event);
    });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(writeFile).mockImplementation(async (path: any, ...rest: any[]) => {
      if (path === join(root, '.docs', 'halted', 'operator-decision.md')) {
        throw new Error('halt record disk full');
      }
      return (actual.writeFile as any)(path, ...rest);
    });

    await expect(writeHaltMarker(root, 'operator decision required\n', 'needs-human', emitter)).resolves.toEqual({
      status: 'written',
    });

    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('operator decision required\n');
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    expect(emitted).toEqual([expect.objectContaining({
      type: 'halt_record_write_failed',
      path: '.docs/halted/operator-decision.md',
      reason: 'halt record disk full',
    })]);
  });

  it('reports a failed marker write and emits its path and reason', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    const emitter = new ConductorEventEmitter();
    const emitted: Array<{ type: 'halt_marker_write_failed'; path: string; reason: string }> = [];
    emitter.on('halt_marker_write_failed', (event) => {
      if (event.type === 'halt_marker_write_failed') emitted.push(event);
    });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(writeFile).mockImplementation(async (path: any, ...rest: any[]) => {
      if (path === join(root, HALT_MARKER)) throw new Error('disk full');
      return (actual.writeFile as any)(path, ...rest);
    });

    await expect(writeHaltMarker(root, 'reason', 'needs-human', emitter)).resolves.toEqual({
      status: 'failed',
      path: join(root, HALT_MARKER),
      reason: 'disk full',
    });
    expect(emitted).toEqual([{
      type: 'halt_marker_write_failed',
      path: join(root, HALT_MARKER),
      reason: 'disk full',
    }]);
  });

  it('returns the write failure even when emitting it fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(writeFile).mockImplementation(async (path: any, ...rest: any[]) => {
      if (path === join(root, HALT_MARKER)) throw new Error('disk full');
      return (actual.writeFile as any)(path, ...rest);
    });
    const emitter = { emit: vi.fn().mockRejectedValue(new Error('event sink unavailable')) } as any;

    await expect(writeHaltMarker(root, 'reason', 'needs-human', emitter)).resolves.toEqual({
      status: 'failed',
      path: join(root, HALT_MARKER),
      reason: 'disk full',
    });
  });

  it('removes a stale halt class before replacing the halt body', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await actual.writeFile(join(root, HALT_CLASS_MARKER), 'mechanical\n', 'utf-8');
    const mockedWriteFile = vi.mocked(writeFile);
    mockedWriteFile.mockImplementation(async (path: any, ...rest: any[]) => {
      if (path === join(root, HALT_MARKER)) {
        await expect(readFile(join(root, HALT_CLASS_MARKER), 'utf-8')).rejects.toThrow();
      }
      return (actual.writeFile as any)(path, ...rest);
    });

    await writeHaltMarker(root, 'replacement reason', 'needs-human');
  });

  it('publishes the halt class atomically after the halt body', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const events: string[] = [];
    vi.mocked(writeFile).mockImplementation(async (path: any, ...rest: any[]) => {
      events.push(path === join(root, HALT_MARKER) ? 'body' : 'class-temp');
      return (actual.writeFile as any)(path, ...rest);
    });
    vi.mocked(rename).mockImplementation(async (from: any, to: any) => {
      if (to === join(root, HALT_CLASS_MARKER)) events.push('class-published');
      return (actual.rename as any)(from, to);
    });

    await writeHaltMarker(root, 'reason', 'needs-human');

    expect(events).toEqual(['body', 'class-temp', 'class-published']);
  });

  it('reports a HALT.class-only failure while preserving the written HALT park marker', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await actual.writeFile(join(root, HALT_CLASS_MARKER), 'mechanical\n', 'utf-8');
    const mockedWriteFile = vi.mocked(writeFile);
    mockedWriteFile.mockImplementation(async (path: any, ...rest: any[]) => {
      if (path !== join(root, HALT_MARKER)) {
        throw new Error('interrupted class write');
      }
      return (actual.writeFile as any)(path, ...rest);
    });

    await expect(writeHaltMarker(root, 'reason', 'needs-human')).resolves.toEqual({
      status: 'partial',
      writtenPath: join(root, HALT_MARKER),
      path: join(root, HALT_CLASS_MARKER),
      reason: 'interrupted class write',
    });

    await expect(readFile(join(root, HALT_MARKER), 'utf-8')).resolves.toBe('reason');
    await expect(readHaltClass(root)).resolves.toBe('unclassified');
  });
});

describe('readHaltClass', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns needs-human when HALT.class contains needs-human (with trailing whitespace)', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await (actual.writeFile as any)(join(root, HALT_CLASS_MARKER), 'needs-human\n', 'utf-8');

    await expect(readHaltClass(root)).resolves.toBe('needs-human');
  });

  it('returns mechanical when HALT.class contains mechanical (trimmed)', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await (actual.writeFile as any)(join(root, HALT_CLASS_MARKER), '  mechanical  ', 'utf-8');

    await expect(readHaltClass(root)).resolves.toBe('mechanical');
  });

  it('returns legacy when HALT.class contains legacy', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await (actual.writeFile as any)(join(root, HALT_CLASS_MARKER), 'legacy', 'utf-8');

    await expect(readHaltClass(root)).resolves.toBe('legacy');
  });

  it('returns plan-gap when HALT.class contains the approved-plan insufficiency class', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await (actual.writeFile as any)(join(root, HALT_CLASS_MARKER), PLAN_GAP_HALT_CLASS, 'utf-8');

    await expect(readHaltClass(root)).resolves.toBe(PLAN_GAP_HALT_CLASS);
  });

  it('returns unclassified when the file is absent', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));

    await expect(readHaltClass(root)).resolves.toBe('unclassified');
  });

  it('returns unclassified when the file is unreadable', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });

    await expect(readHaltClass('/nonexistent/root/that/does/not/exist')).resolves.toBe(
      'unclassified',
    );
  });

  it('returns unclassified for unrecognized garbage content', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await (actual.writeFile as any)(join(root, HALT_CLASS_MARKER), 'garbage-value', 'utf-8');

    await expect(readHaltClass(root)).resolves.toBe('unclassified');
  });
});

async function makeFeatureRepository(): Promise<{ worktree: string; repositoryRoot: string }> {
  const main = await mkdtemp(join(tmpdir(), 'halt-marker-main-'));
  const worktree = join(main, '.worktrees', 'operator-decision');
  const remote = join(main, 'remote.git');
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: main });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: main });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: main });
  await (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).writeFile(join(main, 'README.md'), 'test\n');
  await execa('git', ['add', 'README.md'], { cwd: main });
  await execa('git', ['commit', '-q', '-m', 'initial'], { cwd: main });
  await execa('git', ['init', '--bare', '-b', 'main', '-q', remote]);
  await execa('git', ['worktree', 'add', '-q', '-b', 'feat/operator-decision', worktree], { cwd: main });
  await execa('git', ['remote', 'add', 'origin', remote], { cwd: worktree });
  await execa('git', ['push', '-q', '--set-upstream', 'origin', 'feat/operator-decision'], { cwd: worktree });
  return { worktree, repositoryRoot: main };
}
