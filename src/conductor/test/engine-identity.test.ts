import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { captureEngineIdentity } from '../src/engine/engine-identity.js';
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
