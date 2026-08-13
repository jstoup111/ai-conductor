import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('attributes removed interface, type, and enum members from hunk context', () => {
    expect(deriveBuildReviewRemovals(`diff --git a/src/contracts.ts b/src/contracts.ts
@@ -20,8 +20,7 @@ export interface ReviewContract {
   retained: string;
-  removedFarFromDeclaration?: string;
 }
@@ -40,8 +40,7 @@ export type NestedContract = {
   retained: string;
-  removedTypeMember: number;
 };
@@ -60,8 +60,7 @@ export enum Verdict {
   Pass,
-  Retry,
 }`)).toMatchObject({
      removedMembers: [
        { declaration: 'ReviewContract', member: 'removedFarFromDeclaration' },
        { declaration: 'NestedContract', member: 'removedTypeMember' },
        { declaration: 'Verdict', member: 'Retry' },
      ],
    });
  });

  it('uses an indented exported declaration in a nested namespace hunk', () => {
    expect(deriveBuildReviewRemovals(`diff --git a/src/contracts.ts b/src/contracts.ts
@@ -8,7 +8,6 @@ export namespace Api {
   export interface Nested {
     retained: string;
-    removedNestedMember: boolean;
   }
 }`)).toMatchObject({
      removedMembers: [{ declaration: 'Nested', member: 'removedNestedMember' }],
    });
  });

  it('does not carry an exported type scope past its closing brace', () => {
    expect(deriveBuildReviewRemovals(`diff --git a/src/contracts.ts b/src/contracts.ts
@@ -1,5 +1,4 @@
 export interface Contract {
   retained: string;
 }
-laterMember: string;`)).toEqual({
      deletedFiles: [], removedDeclarations: [], removedMembers: [],
    });
  });

  it('fails safely for renames, textual mentions, and declarations it cannot parse', () => {
    expect(() => deriveBuildReviewRemovals(`diff --git a/src/old.ts b/src/new.ts
similarity index 80%
rename from src/old.ts
rename to src/new.ts
deleted file mode 100644
@@ -1,3 +1 @@
-// export const notAnApi = true
-const text = "export interface AlsoNotAnApi";
-export type MultiLine =`)).not.toThrow();
    expect(deriveBuildReviewRemovals(`diff --git a/src/old.ts b/src/new.ts
similarity index 80%
rename from src/old.ts
rename to src/new.ts
deleted file mode 100644
@@ -1,3 +1 @@
-// export const notAnApi = true
-const text = "export interface AlsoNotAnApi";
-export type MultiLine =`)).toEqual({
      deletedFiles: [], removedDeclarations: [], removedMembers: [],
    });
  });

  it('derives removal evidence without importing a git subprocess boundary', () => {
    expect(readFileSync(new URL('../../src/engine/build-review-removals.ts', import.meta.url), 'utf8')).not.toMatch(
      /node:child_process|execFile|spawn(?:Sync)?\(/,
    );
    expect(deriveBuildReviewRemovals(`diff --git a/src/old.ts b/src/old.ts
@@ -1 +0,0 @@
-export const removed = true;`)).toEqual({
      deletedFiles: [], removedDeclarations: ['removed'], removedMembers: [],
    });
  });
});
