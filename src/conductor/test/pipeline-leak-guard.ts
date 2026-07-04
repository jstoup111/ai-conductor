import { readdir, stat } from 'fs/promises';
import { join, relative } from 'path';

export interface PipelineSnapshot {
  exists: boolean;
  entries: Map<string, { mtimeMs: number; size: number }>;
}

export interface PipelineDiff {
  added: string[];
  modified: string[];
}

/**
 * Create a snapshot of all files in the .pipeline directory.
 * Returns exists: false if .pipeline doesn't exist.
 * Otherwise returns a map of relative paths to file metadata (mtimeMs, size).
 */
export async function snapshotPipeline(cwd: string): Promise<PipelineSnapshot> {
  const pipelinePath = join(cwd, '.pipeline');
  const entries = new Map<string, { mtimeMs: number; size: number }>();

  try {
    // Check if .pipeline exists
    const stats = await stat(pipelinePath);
    if (!stats.isDirectory()) {
      return { exists: false, entries };
    }

    // Recursively read all files in .pipeline
    const files = await walkDir(pipelinePath);
    for (const filePath of files) {
      const fileStats = await stat(filePath);
      if (fileStats.isFile()) {
        const relPath = relative(cwd, filePath);
        entries.set(relPath, {
          mtimeMs: fileStats.mtimeMs,
          size: fileStats.size,
        });
      }
    }

    return { exists: true, entries };
  } catch (err) {
    // .pipeline doesn't exist or is not readable
    return { exists: false, entries };
  }
}

/**
 * Diff two snapshots.
 * Returns:
 * - added: files that exist in 'after' but not in 'before'
 * - modified: files that exist in both but have different mtimeMs or size
 */
export function diffPipeline(
  before: PipelineSnapshot,
  after: PipelineSnapshot
): PipelineDiff {
  const added: string[] = [];
  const modified: string[] = [];

  // If neither snapshot has .pipeline, no changes
  if (!before.exists && !after.exists) {
    return { added, modified };
  }

  // If only 'before' has .pipeline but 'after' doesn't, treat as no leak
  // (we only care about leaks, not cleanup)
  if (before.exists && !after.exists) {
    return { added, modified };
  }

  // If only 'after' has .pipeline, all files are new
  if (!before.exists && after.exists) {
    for (const relPath of after.entries.keys()) {
      added.push(relPath);
    }
    return { added, modified };
  }

  // Both have .pipeline: compare entries
  for (const [relPath, afterMeta] of after.entries.entries()) {
    const beforeMeta = before.entries.get(relPath);

    if (!beforeMeta) {
      // File added
      added.push(relPath);
    } else if (
      beforeMeta.mtimeMs !== afterMeta.mtimeMs ||
      beforeMeta.size !== afterMeta.size
    ) {
      // File modified
      modified.push(relPath);
    }
  }

  return { added, modified };
}

/**
 * Recursively walk a directory and return all file paths.
 */
async function walkDir(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    try {
      const entries = await readdir(currentPath);
      for (const entry of entries) {
        const fullPath = join(currentPath, entry);
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else {
          files.push(fullPath);
        }
      }
    } catch (err) {
      // Ignore read errors in recursive walk
    }
  }

  await walk(dirPath);
  return files;
}
