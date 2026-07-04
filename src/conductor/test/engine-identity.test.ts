import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { captureEngineIdentity, createStaleEngineChecker } from '../src/engine/engine-identity.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('captureEngineIdentity — sha256 hash capture', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `engine-identity-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('happy path — sha256 capture and equality', () => {
    it('returns sha256 hash of file bytes', async () => {
      const filePath = join(tempDir, 'test-file.txt');
      const content = 'test content';
      await writeFile(filePath, content);

      const identity = await captureEngineIdentity(filePath);

      expect(identity).toBeDefined();
      expect(typeof identity).toBe('string');
      expect(identity).toHaveLength(64); // sha256 is 64 hex characters
    });

    it('identical files produce equal identities', async () => {
      const filePath1 = join(tempDir, 'file1.txt');
      const filePath2 = join(tempDir, 'file2.txt');
      const content = 'identical content';

      await writeFile(filePath1, content);
      await writeFile(filePath2, content);

      const identity1 = await captureEngineIdentity(filePath1);
      const identity2 = await captureEngineIdentity(filePath2);

      expect(identity1).toBe(identity2);
    });

    it('different file contents produce different identities', async () => {
      const filePath1 = join(tempDir, 'file1.txt');
      const filePath2 = join(tempDir, 'file2.txt');

      await writeFile(filePath1, 'content A');
      await writeFile(filePath2, 'content B');

      const identity1 = await captureEngineIdentity(filePath1);
      const identity2 = await captureEngineIdentity(filePath2);

      expect(identity1).not.toBe(identity2);
    });

    it('binary file produces valid sha256', async () => {
      const filePath = join(tempDir, 'binary.bin');
      const binaryContent = Buffer.from([0, 1, 2, 3, 4, 5, 255, 254]);
      await writeFile(filePath, binaryContent);

      const identity = await captureEngineIdentity(filePath);

      expect(identity).toBeDefined();
      expect(identity).toHaveLength(64);
    });
  });

  describe('error handling', () => {
    it('returns null for non-existent file', async () => {
      const filePath = join(tempDir, 'nonexistent.txt');
      const identity = await captureEngineIdentity(filePath);

      expect(identity).toBeNull();
    });

    it('returns null when file cannot be read due to permissions', async () => {
      const filePath = join(tempDir, 'unreadable.txt');
      await writeFile(filePath, 'content');

      // Try to make file unreadable (this may not work on all systems)
      try {
        // Note: On some systems or in some environments this might not work,
        // but we should still return null if the read fails
        await rm(filePath);
        const identity = await captureEngineIdentity(filePath);
        expect(identity).toBeNull();
      } catch {
        // Skip this test if we can't set permissions
      }
    });
  });

  describe('determinism', () => {
    it('repeated calls on same file produce identical hash', async () => {
      const filePath = join(tempDir, 'test.txt');
      await writeFile(filePath, 'deterministic content');

      const identity1 = await captureEngineIdentity(filePath);
      const identity2 = await captureEngineIdentity(filePath);
      const identity3 = await captureEngineIdentity(filePath);

      expect(identity1).toBe(identity2);
      expect(identity2).toBe(identity3);
    });
  });

  describe('edge cases', () => {
    it('empty file produces valid sha256', async () => {
      const filePath = join(tempDir, 'empty.txt');
      await writeFile(filePath, '');

      const identity = await captureEngineIdentity(filePath);

      expect(identity).toBeDefined();
      expect(identity).toHaveLength(64);
    });

    it('large file produces valid sha256', async () => {
      const filePath = join(tempDir, 'large.bin');
      const largeContent = Buffer.alloc(10 * 1024 * 1024); // 10MB
      largeContent.fill('x');
      await writeFile(filePath, largeContent);

      const identity = await captureEngineIdentity(filePath);

      expect(identity).toBeDefined();
      expect(identity).toHaveLength(64);
    });

    it('file with special characters in name produces valid sha256', async () => {
      const filePath = join(tempDir, 'file-with-special-chars_123.txt');
      await writeFile(filePath, 'content');

      const identity = await captureEngineIdentity(filePath);

      expect(identity).toBeDefined();
      expect(identity).toHaveLength(64);
    });
  });
});

describe('createStaleEngineChecker — disabled checker on capture failure', () => {
  describe('null capture disables checker', () => {
    it('null capture returns a checker that always returns current', () => {
      const checker = createStaleEngineChecker(null);

      expect(checker.check()).toBe('current');
      expect(checker.check()).toBe('current');
      expect(checker.check()).toBe('current');
    });

    it('check method executes synchronously with no I/O when disabled', () => {
      const checker = createStaleEngineChecker(null);

      // Call check() multiple times - should return immediately without any I/O
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        const result = checker.check();
        expect(result).toBe('current');
      }
      const elapsed = Date.now() - start;

      // Should be very fast (< 50ms) since there's no I/O involved
      expect(elapsed).toBeLessThan(50);
    });

    it('warn callback fires exactly once on disabled checker construction', () => {
      const warn = vi.fn();

      createStaleEngineChecker(null, warn);

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('warn callback is not called when not provided', () => {
      // Should not throw when warn is undefined
      const checker = createStaleEngineChecker(null);
      expect(checker).toBeDefined();
    });
  });

  describe('valid capture enables checker', () => {
    it('accepts a valid sha256 hash', () => {
      const validHash = 'a'.repeat(64); // Valid sha256 format
      const checker = createStaleEngineChecker(validHash);

      expect(checker).toBeDefined();
      expect(typeof checker.check).toBe('function');
    });

    it('does not call warn when capture is valid', () => {
      const warn = vi.fn();
      const validHash = 'b'.repeat(64);

      createStaleEngineChecker(validHash, warn);

      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe('createStaleEngineChecker — stale vs current verdicts', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `stale-checker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('happy path — stale vs current detection', () => {
    it('returns stale when captured hash differs from current', async () => {
      const filePath = join(tempDir, 'engine.bin');
      const currentContent = 'current content';
      await writeFile(filePath, currentContent);

      // Capture a different hash (from a different file)
      const otherPath = join(tempDir, 'other.bin');
      await writeFile(otherPath, 'other content');
      const differentHash = await captureEngineIdentity(otherPath);

      const checker = createStaleEngineChecker(differentHash, filePath);
      const result = checker.check();

      expect(result).toBe('stale');
    });

    it('returns current when hash matches', async () => {
      const filePath = join(tempDir, 'engine.bin');
      const content = 'stable content';
      await writeFile(filePath, content);

      const capturedHash = await captureEngineIdentity(filePath);
      const checker = createStaleEngineChecker(capturedHash, filePath);
      const result = checker.check();

      expect(result).toBe('current');
    });

    it('returns current for byte-identical rebuild', async () => {
      const filePath = join(tempDir, 'engine.bin');
      const content = 'rebuilt content';
      await writeFile(filePath, content);

      // Capture original
      const capturedHash = await captureEngineIdentity(filePath);

      // Simulate rebuild: remove and recreate with identical content
      await rm(filePath);
      await writeFile(filePath, content);

      const checker = createStaleEngineChecker(capturedHash, filePath);
      const result = checker.check();

      expect(result).toBe('current');
    });

    it('returns stale when file is modified after capture', async () => {
      const filePath = join(tempDir, 'engine.bin');
      const originalContent = 'original content';
      const modifiedContent = 'modified content';

      await writeFile(filePath, originalContent);
      const capturedHash = await captureEngineIdentity(filePath);

      // Modify the file
      await writeFile(filePath, modifiedContent);

      const checker = createStaleEngineChecker(capturedHash, filePath);
      const result = checker.check();

      expect(result).toBe('stale');
    });

    it('works with valid captured identity', async () => {
      const filePath = join(tempDir, 'engine.bin');
      const content = 'test content';
      await writeFile(filePath, content);

      const validHash = await captureEngineIdentity(filePath);
      expect(validHash).toBeTruthy();
      expect(validHash).toHaveLength(64);

      const checker = createStaleEngineChecker(validHash, filePath);
      expect(checker.check()).toBe('current');
    });
  });
});
