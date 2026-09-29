// Covers: task:12
import { describe, expect, it } from 'vitest';
import { GIT_GUARD_SCRIPT } from '../../src/engine/git-hook-assets.js';

describe('engine git guard boundary', () => {
  it('keeps the wrapper process-local and preserves lease pushes for engine CLIs', () => {
    expect(GIT_GUARD_SCRIPT).toContain('exec "$real_git" "$@"');
    expect(GIT_GUARD_SCRIPT).toContain('git push --force-with-lease');
    expect(process.env.PATH).not.toContain('/.pipeline/bin');
  });
});
