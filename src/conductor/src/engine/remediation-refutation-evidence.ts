import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { isCanonicalBuildReviewRepoRelativePath } from './build-review-scope-source.js';
import type { RemediationCaseRefutation } from './remediation-case-artifact.js';

export type ResolveRefutationEvidenceResult =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly reason: 'unresolvable-refutation-evidence';
    readonly path: string;
    readonly excerpt?: string;
  };

export interface ResolveRefutationEvidenceInput {
  readonly projectRoot: string;
  readonly refutation: RemediationCaseRefutation;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export async function resolveRefutationEvidence({
  projectRoot,
  refutation,
}: ResolveRefutationEvidenceInput): Promise<ResolveRefutationEvidenceResult> {
  for (const assertion of refutation.assertions) {
    for (const evidence of assertion.evidence) {
      if (!isCanonicalBuildReviewRepoRelativePath(evidence.path)) {
        return { ok: false, reason: 'unresolvable-refutation-evidence', path: evidence.path };
      }

      const evidencePath = join(projectRoot, evidence.path);
      let metadata: Awaited<ReturnType<typeof stat>>;
      try {
        metadata = await stat(evidencePath);
      } catch {
        return { ok: false, reason: 'unresolvable-refutation-evidence', path: evidence.path };
      }
      if (!metadata.isFile()) {
        return { ok: false, reason: 'unresolvable-refutation-evidence', path: evidence.path };
      }

      let contents: string;
      try {
        contents = await readFile(evidencePath, 'utf8');
      } catch {
        return {
          ok: false,
          reason: 'unresolvable-refutation-evidence',
          path: evidence.path,
          excerpt: evidence.excerpt,
        };
      }
      const excerpt = normalize(evidence.excerpt);
      // `''.includes('')` is true, but an empty normalized excerpt is not
      // evidence. Reject it at the admission boundary before containment.
      if (!excerpt || !normalize(contents).includes(excerpt)) {
        return {
          ok: false,
          reason: 'unresolvable-refutation-evidence',
          path: evidence.path,
          excerpt: evidence.excerpt,
        };
      }
    }
  }
  return { ok: true };
}
