import { stat, readdir } from 'fs/promises';
import { join } from 'path';

/**
 * Metadata snapshot of a single file: size and mtime for leak detection.
 */
export interface FileMeta {
  size: number;
  mtime: number;
}

/**
 * Snapshot of the .pipeline directory state at a given moment.
 * Used to detect leaks by comparing before/after snapshots.
 */
export interface PipelineSnapshot {
  exists: boolean;
  entries: Map<string, FileMeta>; // Map from relative path (e.g., ".pipeline/HALT") to metadata
}

/**
 * Result of comparing two pipeline snapshots.
 * Lists files that were added or modified between before/after.
 */
export interface PipelineDiff {
  added: string[];
  modified: string[];
}

/**
 * Recursively scan the .pipeline directory and snapshot its contents.
 * Returns exists: false if .pipeline does not exist; otherwise returns all files with their metadata.
 *
 * @param cwd Working directory to scan for .pipeline
 * @returns Snapshot of .pipeline state
 */
export async function snapshotPipeline(cwd: string): Promise<PipelineSnapshot> {
  const pipelinePath = join(cwd, '.pipeline');
  const entries = new Map<string, FileMeta>();

  try {
    // Try to read the .pipeline directory
    const dirExists = await stat(pipelinePath).catch(() => null);
    if (!dirExists?.isDirectory()) {
      return { exists: false, entries };
    }

    // Recursively collect all files under .pipeline
    async function walk(dir: string, prefix: string): Promise<void> {
      const files = await readdir(dir, { withFileTypes: true });
      for (const file of files) {
        const fullPath = join(dir, file.name);
        const relativePath = join(prefix, file.name);

        if (file.isDirectory()) {
          await walk(fullPath, relativePath);
        } else if (file.isFile()) {
          const fileStat = await stat(fullPath);
          entries.set(relativePath, {
            size: fileStat.size,
            mtime: fileStat.mtimeMs,
          });
        }
      }
    }

    await walk(pipelinePath, '.pipeline');
    return { exists: true, entries };
  } catch {
    // If any error occurs, treat .pipeline as not existing
    return { exists: false, entries };
  }
}

/**
 * Compare two pipeline snapshots and identify added/modified files.
 * A file is "added" if it exists in `after` but not in `before`.
 * A file is "modified" if it exists in both but has different size or mtime.
 *
 * @param before Snapshot from before the test
 * @param after Snapshot from after the test
 * @returns Diff showing added and modified files
 */
export function diffPipeline(before: PipelineSnapshot, after: PipelineSnapshot): PipelineDiff {
  const added: string[] = [];
  const modified: string[] = [];

  // Check entries in after that were not in before (added)
  // or whose metadata changed (modified)
  for (const [path, afterMeta] of after.entries) {
    const beforeMeta = before.entries.get(path);
    if (!beforeMeta) {
      added.push(path);
    } else if (
      beforeMeta.size !== afterMeta.size ||
      beforeMeta.mtime !== afterMeta.mtime
    ) {
      modified.push(path);
    }
  }

  return { added, modified };
}
