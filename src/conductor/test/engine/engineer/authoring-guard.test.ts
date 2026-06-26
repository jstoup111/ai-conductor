// Test: path-prefix write guard (Task 34, FR-11, C1)
//
// The AuthoringGuard is a pure/deterministic primitive. Given a target repo's
// canonical absolute path, it validates that every write path is a descendant
// of that prefix. Any path that escapes (via `..`, absolute path outside, or
// symlink-style traversal as string check) is rejected with a named error.
//
// Happy paths: writes under the canonical path pass (guard returns void).
// Negative paths: escaping writes are rejected with PathEscapeError BEFORE any
// filesystem mutation (fail-fast, pure string check).

import { describe, it, expect } from 'vitest';
import {
  AuthoringGuard,
  PathEscapeError,
} from '../../../src/engine/engineer/authoring-guard.js';

const CANONICAL = '/home/project/alpha';

describe('AuthoringGuard — happy paths (writes under canonical path pass)', () => {
  it('accepts a direct child path', () => {
    const guard = new AuthoringGuard(CANONICAL);
    expect(() => guard.assertWriteAllowed(`${CANONICAL}/file.md`)).not.toThrow();
  });

  it('accepts a nested descendant path', () => {
    const guard = new AuthoringGuard(CANONICAL);
    expect(() => guard.assertWriteAllowed(`${CANONICAL}/.docs/stories/idea.md`)).not.toThrow();
  });

  it('accepts a deeply nested path', () => {
    const guard = new AuthoringGuard(CANONICAL);
    expect(() =>
      guard.assertWriteAllowed(`${CANONICAL}/a/b/c/d/e.txt`),
    ).not.toThrow();
  });

  it('accepts path equal to canonical root itself', () => {
    // Writing to the root is allowed (e.g., creating a directory at the root)
    const guard = new AuthoringGuard(CANONICAL);
    expect(() => guard.assertWriteAllowed(CANONICAL)).not.toThrow();
  });
});

describe('AuthoringGuard — negative paths (escaping writes are rejected)', () => {
  it('rejects a sibling path (different repo)', () => {
    const guard = new AuthoringGuard(CANONICAL);
    expect(() => guard.assertWriteAllowed('/home/project/beta/file.md')).toThrow(PathEscapeError);
  });

  it('rejects a dotdot traversal one level up from canonical', () => {
    const guard = new AuthoringGuard(CANONICAL);
    expect(() =>
      guard.assertWriteAllowed(`${CANONICAL}/../beta/file.md`),
    ).toThrow(PathEscapeError);
  });

  it('rejects a dotdot traversal escaping to root', () => {
    const guard = new AuthoringGuard(CANONICAL);
    expect(() =>
      guard.assertWriteAllowed(`${CANONICAL}/../../etc/passwd`),
    ).toThrow(PathEscapeError);
  });

  it('rejects an absolute path to a completely different location', () => {
    const guard = new AuthoringGuard(CANONICAL);
    expect(() => guard.assertWriteAllowed('/tmp/evil.md')).toThrow(PathEscapeError);
  });

  it('rejects a path that shares a prefix but is not a descendant (alphaX case)', () => {
    // /home/project/alphaX must not be allowed just because it starts with /home/project/alpha
    const guard = new AuthoringGuard(CANONICAL);
    expect(() => guard.assertWriteAllowed('/home/project/alphaX/file.md')).toThrow(PathEscapeError);
  });

  it('rejects an empty path', () => {
    const guard = new AuthoringGuard(CANONICAL);
    expect(() => guard.assertWriteAllowed('')).toThrow(PathEscapeError);
  });

  it('rejects a relative path (not absolute)', () => {
    const guard = new AuthoringGuard(CANONICAL);
    expect(() => guard.assertWriteAllowed('relative/path/file.md')).toThrow(PathEscapeError);
  });

  it('error message includes the rejected path and canonical prefix', () => {
    const guard = new AuthoringGuard(CANONICAL);
    const escapingPath = '/home/project/beta/file.md';
    try {
      guard.assertWriteAllowed(escapingPath);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PathEscapeError);
      expect((err as PathEscapeError).message).toContain(escapingPath);
      expect((err as PathEscapeError).message).toContain(CANONICAL);
    }
  });

  it('error name is PathEscapeError', () => {
    const guard = new AuthoringGuard(CANONICAL);
    try {
      guard.assertWriteAllowed('/tmp/evil.md');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PathEscapeError);
      expect((err as PathEscapeError).name).toBe('PathEscapeError');
    }
  });
});
