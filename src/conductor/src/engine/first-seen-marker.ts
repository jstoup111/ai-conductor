import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const directory = (mainRoot: string) => join(mainRoot, '.daemon', 'first-seen');
const pathFor = (mainRoot: string, slug: string) => join(directory(mainRoot), slug);

/** Record a discovery timestamp once.  Discovery observability must never block dispatch. */
export async function recordFirstSeen(mainRoot: string, slug: string, now = Date.now()): Promise<void> {
  const path = pathFor(mainRoot, slug);
  // `link` provides the create-once operation for the marker itself.  The
  // temporary is merely private staging, so it needs a unique name rather than
  // O_EXCL — exclusive opens belong solely to the daemon lock boundary.
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory(mainRoot), { recursive: true });
    await writeFile(temporary, String(now));
    await link(temporary, path).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') return;
      throw error;
    });
  } catch {
    // best effort: a missing age must never make a discoverable feature disappear
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Read a first-seen timestamp, returning undefined for absent, corrupt, or unreadable markers. */
export async function readFirstSeen(mainRoot: string, slug: string): Promise<number | undefined> {
  try {
    const value = Number((await readFile(pathFor(mainRoot, slug), 'utf8')).trim());
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
