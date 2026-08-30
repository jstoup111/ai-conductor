import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';

/** A document carried across the dispatcher-to-executor boundary. */
export interface ManifestEntry {
  ref: string;
  contentHash: string;
}

/**
 * Plain serializable input for one feature executor.
 *
 * The manifest transports the dispatcher-resolved governing documents; it is
 * not persisted as an artifact-resolution authority.
 */
export interface WorkOrder {
  repository: string;
  slug: string;
  baseSha: string;
  manifest: ManifestEntry[];
}

export interface WorkOrderGitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Injected Git boundary so work-order construction remains unit-testable. */
export type WorkOrderGitRunner = (args: readonly string[]) => Promise<WorkOrderGitResult>;

export interface BuildWorkOrderInput {
  repository: string;
  slug: string;
  baseSha: string;
  documentRefs: readonly string[];
}

/**
 * Resolves the governing specification documents at the pinned base and
 * creates the serializable dispatcher-to-executor work order.
 */
export async function buildWorkOrder(
  input: BuildWorkOrderInput,
  git: WorkOrderGitRunner,
): Promise<WorkOrder> {
  for (const ref of input.documentRefs) {
    if (posix.isAbsolute(ref) || win32.isAbsolute(ref)) {
      throw new Error(`document ref must be repository-relative: ${ref}`);
    }
  }

  const manifest = await Promise.all(input.documentRefs.map(async (ref) => {
    const result = await git(['show', `${input.baseSha}:${ref}`]);
    if (result.exitCode !== 0) {
      throw new Error(`could not resolve work-order document ${ref}: ${result.stderr}`);
    }
    return {
      ref,
      contentHash: `sha256:${createHash('sha256').update(result.stdout).digest('hex')}`,
    };
  }));

  return {
    repository: input.repository,
    slug: input.slug,
    baseSha: input.baseSha,
    manifest,
  };
}
