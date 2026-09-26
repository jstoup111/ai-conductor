// Covers: task:5
import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_ENGINE_OWNED_LAP_WRITES,
  captureBuildReviewInputDigest,
  diffBuildReviewInputDigests,
  type BuildReviewInputIntegrityFilesystem,
} from '../../src/engine/build-review-input-integrity.js';

type FileTree = Record<string, string>;

function filesystem(tree: FileTree): BuildReviewInputIntegrityFilesystem {
  return {
    async readdir(path) {
      const prefix = `${path}/`;
      const names = new Set<string>();
      for (const file of Object.keys(tree)) {
        if (!file.startsWith(prefix)) continue;
        const [name] = file.slice(prefix.length).split('/');
        if (name) names.add(name);
      }
      return [...names].sort();
    },
    async lstat(path) {
      if (Object.hasOwn(tree, path)) return { kind: 'file' };
      if (Object.keys(tree).some((file) => file.startsWith(`${path}/`))) return { kind: 'directory' };
      throw new Error(`ENOENT: ${path}`);
    },
    async readFile(path) {
      const content = tree[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return Buffer.from(content, 'utf8');
    },
  };
}

function roots() {
  return {
    frozenHead: '/head',
    frozenBaseline: '/baseline',
    capturedPolicyMaterial: '/policy-material',
    installedPolicyPackage: '/policy-package',
    evidenceRoot: '/evidence',
  } as const;
}

const initialTree: FileTree = {
  '/head/src/review.ts': 'original head',
  '/baseline/src/base.ts': 'original baseline',
  '/policy-material/SKILL.md': 'captured policy',
  '/policy-package/SKILL.md': 'installed policy',
  '/evidence/proof.json': 'original evidence',
};

describe('engine/build-review-input-integrity', () => {
  it.each([
    ['frozenHead', '/head/src/review.ts', 'changed head'],
    ['frozenBaseline', '/baseline/src/base.ts', 'changed baseline'],
    ['capturedPolicyMaterial', '/policy-material/SKILL.md', 'changed captured policy'],
    ['installedPolicyPackage', '/policy-package/SKILL.md', 'changed installed policy'],
  ] as const)('reports a modified file under %s', async (_kind, path, content) => {
    const before = await captureBuildReviewInputDigest(roots(), filesystem(initialTree));
    const after = await captureBuildReviewInputDigest(roots(), filesystem({ ...initialTree, [path]: content }));

    await expect(diffBuildReviewInputDigests(before, after)).resolves.toEqual([`${_kind}:${path.split('/').slice(2).join('/')}`]);
  });

  it.each([
    ['added', (tree: FileTree) => ({ ...tree, '/head/src/new.ts': 'new' }), '/head/src/new.ts'],
    ['removed', (tree: FileTree) => {
      const { '/policy-package/SKILL.md': _removed, ...remaining } = tree;
      return remaining;
    }, '/policy-package/SKILL.md'],
  ] as const)('reports an %s file under a protected root', async (_change, mutate, path) => {
    const before = await captureBuildReviewInputDigest(roots(), filesystem(initialTree));
    const after = await captureBuildReviewInputDigest(roots(), filesystem(mutate(initialTree)));

    const rootKind = path.startsWith('/head/') ? 'frozenHead' : 'installedPolicyPackage';
    await expect(diffBuildReviewInputDigests(before, after)).resolves.toEqual([`${rootKind}:${path.split('/').slice(2).join('/')}`]);
  });

  it('ignores new evidence but reports a changed captured evidence file', async () => {
    const before = await captureBuildReviewInputDigest(roots(), filesystem(initialTree));
    const after = await captureBuildReviewInputDigest(roots(), filesystem({
      ...initialTree,
      '/evidence/proof.json': 'changed evidence',
      '/evidence/reviewer-result.json': 'new evidence',
    }));

    await expect(diffBuildReviewInputDigests(before, after)).resolves.toEqual(['evidenceRoot:proof.json']);
  });

  it('returns no changes for identical captures without accepting a feature checkout root', async () => {
    const before = await captureBuildReviewInputDigest(roots(), filesystem(initialTree));
    const after = await captureBuildReviewInputDigest(roots(), filesystem(initialTree));

    await expect(diffBuildReviewInputDigests(before, after)).resolves.toEqual([]);
  });

  it('excludes the engine-owned in-lap writes while prior-lap build-review evidence stays hashed', async () => {
    const tree: FileTree = {
      ...initialTree,
      '/evidence/events.jsonl': '{"type":"before"}\n',
      '/evidence/audit-trail/events.jsonl': '{"type":"before"}\n',
      '/evidence/step-heartbeat': '{"ts":"before"}\n',
      '/evidence/build-review/cache/security.json': 'cached before',
      '/evidence/build-review/policy-material/portable/SKILL.md': 'captured before',
      '/evidence/build-review/lap-old/portable.json': 'prior lap evidence',
    };
    const excluded = { ...roots(), evidenceRootExcludes: BUILD_REVIEW_ENGINE_OWNED_LAP_WRITES };
    const before = await captureBuildReviewInputDigest(excluded, filesystem(tree));
    const after = await captureBuildReviewInputDigest(excluded, filesystem({
      ...tree,
      '/evidence/events.jsonl': '{"type":"before"}\n{"type":"build_review_policy_resolved"}\n',
      '/evidence/audit-trail/events.jsonl': '{"type":"before"}\n{"type":"after"}\n',
      '/evidence/step-heartbeat': '{"ts":"after"}\n',
      '/evidence/build-review/cache/security.json': 'cached after',
      '/evidence/build-review/policy-material/portable/SKILL.md': 'captured again',
      '/evidence/build-review/lap-old/portable.json': 'rewritten prior lap evidence',
    }));

    await expect(diffBuildReviewInputDigests(before, after)).resolves.toEqual(['evidenceRoot:build-review/lap-old/portable.json']);
  });
});
