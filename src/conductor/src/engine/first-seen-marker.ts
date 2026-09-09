import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const directory = (mainRoot: string) => join(mainRoot, '.daemon', 'first-seen');
const pathFor = (mainRoot: string, slug: string) => join(directory(mainRoot), slug);

export interface FirstSeenMarker { state: string; enteredAt: number }

/** Record state residence, preserving the timestamp while the state is unchanged. */
export async function recordFirstSeen(mainRoot: string, slug: string, state: string, now = Date.now()): Promise<void> {
  const path = pathFor(mainRoot, slug);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory(mainRoot), { recursive: true });
    const previous = await readFirstSeen(mainRoot, slug);
    if (previous?.state === state) return;
    await writeFile(temporary, JSON.stringify({ state, enteredAt: now }));
    await rename(temporary, path);
  } catch {
    // best effort: a missing age must never make a discoverable feature disappear
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Read a first-seen timestamp, returning undefined for absent, corrupt, or unreadable markers. */
export async function readFirstSeen(mainRoot: string, slug: string): Promise<FirstSeenMarker | undefined> {
  try {
    const value = JSON.parse(await readFile(pathFor(mainRoot, slug), 'utf8')) as Partial<FirstSeenMarker>;
    return typeof value.state === 'string' && Number.isFinite(value.enteredAt)
      ? { state: value.state, enteredAt: value.enteredAt! } : undefined;
  } catch {
    return undefined;
  }
}
