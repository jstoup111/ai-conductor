// Covers: task:24
import { describe, expect, it } from 'vitest';
import { auditGithubInvocationSource } from '../../../src/engine/github-invocation-audit.js';

describe('GitHub invocation audit', () => {
  it('accepts approved adapters and local Git, while rejecting direct remote mutations', () => {
    expect(auditGithubInvocationSource('remote-git-operations.ts', "import { execFile } from 'node:child_process';")).toEqual([]);
    expect(auditGithubInvocationSource('local.ts', "await git(['status']);")).toEqual([]);
    expect(auditGithubInvocationSource('bypass.ts', "await git(['push', 'origin', 'main']);"))
      .toEqual([{ file: 'bypass.ts', message: 'direct remote Git mutation outside executeRemoteGit' }]);
    expect(auditGithubInvocationSource('bypass.ts', "await gh(['pr', 'create']);"))
      .toEqual([{ file: 'bypass.ts', message: 'direct PR mutation outside executeGithubOperation' }]);
  });
});
