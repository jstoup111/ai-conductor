import { describe, it, expect } from 'vitest';
import { parseDirtyStatus } from '../../src/engine/leak-triage.js';

describe('engine/leak-triage', () => {
  describe('parseDirtyStatus', () => {
    it('parses empty status output', () => {
      const result = parseDirtyStatus('');
      expect(result).toEqual({
        modified: [],
        untracked: [],
        staged: [],
      });
    });

    it('parses a modified file not staged ( M)', () => {
      const result = parseDirtyStatus(' M src/file.ts\n');
      expect(result.modified).toContain('src/file.ts');
      expect(result.untracked).toHaveLength(0);
      expect(result.staged).toHaveLength(0);
    });

    it('parses a modified file staged (M )', () => {
      const result = parseDirtyStatus('M  src/file.ts\n');
      expect(result.staged).toContain('src/file.ts');
      expect(result.modified).toHaveLength(0);
      expect(result.untracked).toHaveLength(0);
    });

    it('parses a file modified in both index and working tree (MM)', () => {
      const result = parseDirtyStatus('MM src/file.ts\n');
      expect(result.modified).toContain('src/file.ts');
      expect(result.staged).toContain('src/file.ts');
      expect(result.untracked).toHaveLength(0);
    });

    it('parses an untracked file (??)', () => {
      const result = parseDirtyStatus('?? src/new.ts\n');
      expect(result.untracked).toContain('src/new.ts');
      expect(result.modified).toHaveLength(0);
      expect(result.staged).toHaveLength(0);
    });

    it('parses a renamed file (R  old.ts -> new.ts)', () => {
      const result = parseDirtyStatus('R  old.ts -> new.ts\n');
      expect(result.modified).toContain('old.ts -> new.ts');
      expect(result.untracked).toHaveLength(0);
      expect(result.staged).toHaveLength(0);
    });

    it('parses multiple files with mixed statuses', () => {
      const output = ` M src/modified.ts
M  src/staged.ts
MM src/both.ts
?? src/new.ts
R  old.ts -> new.ts
`;
      const result = parseDirtyStatus(output);
      expect(result.modified).toContain('src/modified.ts');
      expect(result.modified).toContain('src/both.ts');
      expect(result.modified).toContain('old.ts -> new.ts');
      expect(result.staged).toContain('src/staged.ts');
      expect(result.staged).toContain('src/both.ts');
      expect(result.untracked).toContain('src/new.ts');
    });

    it('preserves file paths with spaces', () => {
      const result = parseDirtyStatus('?? "src/file with spaces.ts"\n');
      expect(result.untracked.length).toBeGreaterThan(0);
    });

    it('handles deleted files (D  or  D)', () => {
      const resultStaged = parseDirtyStatus('D  src/deleted.ts\n');
      expect(resultStaged.modified).toContain('src/deleted.ts');

      const resultUnstaged = parseDirtyStatus(' D src/deleted.ts\n');
      expect(resultUnstaged.modified).toContain('src/deleted.ts');
    });

    it('ignores blank lines', () => {
      const output = ` M src/file1.ts

M  src/file2.ts
`;
      const result = parseDirtyStatus(output);
      expect(result.modified).toContain('src/file1.ts');
      expect(result.staged).toContain('src/file2.ts');
    });
  });
});
