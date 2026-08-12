import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    rename: vi.fn(actual.rename),
  };
});

import { writeFile, rename, mkdir } from 'node:fs/promises';
import { writeHaltMarker, readHaltClass, HALT_MARKER, HALT_CLASS_MARKER } from '../../src/engine/halt-marker';
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

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes HALT.class with the given halt class', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await expect(writeHaltMarker(root, 'reason', 'needs-human')).resolves.toEqual({ status: 'written' });
    const contents = await readFile(join(root, HALT_CLASS_MARKER), 'utf-8');
    expect(contents).toContain('needs-human');
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

  it('leaves no retryable old class when the replacement class write is interrupted', async () => {
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
      status: 'failed',
      path: join(root, HALT_MARKER),
      reason: 'interrupted class write',
    });

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
