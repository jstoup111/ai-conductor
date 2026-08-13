import { describe, expect, it } from 'vitest';
import { deriveBuildReviewRemovals } from '../../src/engine/build-review-removals.js';

describe('deriveBuildReviewRemovals', () => {
  it('reports deleted files, exported declarations, and no removals for additive diffs', () => {
    expect(deriveBuildReviewRemovals(`diff --git a/src/obsolete.ts b/src/obsolete.ts
deleted file mode 100644
diff --git a/src/api.ts b/src/api.ts
@@ -1,3 +1,2 @@
-export const obsoleteAdapter = true;
+export const retainedAdapter = true;`)).toEqual({
      deletedFiles: ['src/obsolete.ts'],
      removedDeclarations: ['obsoleteAdapter'],
      removedMembers: [],
    });
    expect(deriveBuildReviewRemovals('diff --git a/x.ts b/x.ts\n+@@ -1 +1 @@\n+ export const added = true;')).toEqual({
      deletedFiles: [], removedDeclarations: [], removedMembers: [],
    });
  });
});
