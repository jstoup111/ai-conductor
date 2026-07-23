// engineer/intake/queue.ts — IntakeQueue interface + file-backed factory.
// FR-29, FR-30, ADR-011, T9–T12.
// C1 constraint: claim uses its own atomic primitive (fs.rename / ENOENT race).
// The engine lock module is intentionally not imported here (ADR-011 §4).

import { mkdir, readdir, rename, unlink, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Envelope } from './port.js';

// ─── IntakeQueue ──────────────────────────────────────────────────────────────

/**
 * Durable inbox for Envelopes.
 *
 * - enqueue: persist an Envelope; must be idempotent on Envelope.id.
 * - claim:   atomically take the oldest un-claimed Envelope (by receivedAt),
 *            or return null when the inbox is empty.
 * - ack:     mark a previously claimed Envelope as processed (remove from inbox).
 * - release: return a claimed Envelope to the inbox for re-delivery.
 *
 * FR-29/FR-30, ADR-011.
 */
export interface IntakeQueue {
  enqueue(e: Envelope): Promise<void>;
  claim(): Promise<Envelope | null>;
  ack(e: Envelope): Promise<void>;
  release(e: Envelope): Promise<void>;
  /** List all pending (un-claimed) Envelopes currently in the inbox. */
  list(): Promise<Envelope[]>;
  /** Remove a pending Envelope from the inbox. Benign no-op if already absent. */
  remove(e: Envelope): Promise<void>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Sanitize a string for use in a filename by replacing any character that is
 * not alphanumeric, `-`, or `.` with `_`.  ISO-8601 colons and path slashes
 * are the most common offenders.
 */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9\-.]/g, '_');
}

/** Filename for a pending (un-claimed) envelope. Sorts oldest-first. */
function pendingName(e: Envelope): string {
  return `${sanitize(e.receivedAt)}__${sanitize(e.id)}.json`;
}

/** Filename for a claimed (in-flight) envelope. */
function claimedName(e: Envelope): string {
  return `${sanitize(e.receivedAt)}__${sanitize(e.id)}.claimed`;
}

/** Convert a pending filename to its claimed counterpart. */
function toClaimed(filename: string): string {
  return filename.replace(/\.json$/, '.claimed');
}

/** Convert a claimed filename to its pending counterpart. */
function toPending(filename: string): string {
  return filename.replace(/\.claimed$/, '.json');
}

// ─── createFileQueue ──────────────────────────────────────────────────────────

/**
 * Create a file-backed IntakeQueue rooted at `dir`.
 *
 * Atomic-claim primitive: `fs.rename` is a single POSIX syscall.  When two
 * concurrent claim() calls both try to rename the same `.json` → `.claimed`,
 * only the first succeeds; the second receives ENOENT and skips to the next
 * candidate (or returns null).  No external lock module is imported here
 * (C1, ADR-011 §4 — the engine lock and intake lock are fully independent).
 *
 * File layout inside `dir`:
 *   <sanitised-receivedAt>__<sanitised-id>.json     — pending
 *   <sanitised-receivedAt>__<sanitised-id>.claimed  — in-flight
 *
 * Filenames sort lexicographically oldest-first because ISO-8601 strings
 * sort correctly after `:` → `_` substitution.
 */
export function createFileQueue(dir: string): IntakeQueue {
  return {
    // ── enqueue ─────────────────────────────────────────────────────────────

    async enqueue(e: Envelope): Promise<void> {
      await mkdir(dir, { recursive: true });
      const filepath = join(dir, pendingName(e));
      // Overwrite (flag 'w') → idempotent on same Envelope.id + receivedAt.
      await writeFile(filepath, JSON.stringify(e), { flag: 'w' });
    },

    // ── claim ────────────────────────────────────────────────────────────────

    async claim(): Promise<Envelope | null> {
      // Ensure the directory exists (first claim before any enqueue).
      await mkdir(dir, { recursive: true });

      const entries = await readdir(dir);
      const pendingFiles = entries.filter((f) => f.endsWith('.json')).sort();

      if (pendingFiles.length === 0) return null;

      // Pre-validate ALL pending files before touching anything.
      // This surfaces corruption immediately (C: "without losing valid entries")
      // because we throw before any claim renames have occurred.
      for (const filename of pendingFiles) {
        const filepath = join(dir, filename);
        let content: string;
        try {
          content = await readFile(filepath, 'utf8');
        } catch {
          // File disappeared between readdir and readFile (concurrent claim/ack).
          // Not corruption — skip it.
          continue;
        }
        try {
          JSON.parse(content);
        } catch {
          throw new Error(`Corrupt inbox entry: failed to parse file "${filename}"`);
        }
      }

      // Atomically claim the oldest pending entry.
      // fs.rename is a single POSIX syscall: the first concurrent caller that
      // renames "x.json" → "x.claimed" succeeds; all subsequent callers get
      // ENOENT (the source is gone) and skip to the next candidate.
      for (const filename of pendingFiles) {
        const pendingPath = join(dir, filename);
        const claimedPath = join(dir, toClaimed(filename));

        try {
          await rename(pendingPath, claimedPath);
        } catch (err: unknown) {
          const nodeErr = err as NodeJS.ErrnoException;
          if (nodeErr.code === 'ENOENT') {
            // Another concurrent claim won this slot; try the next candidate.
            continue;
          }
          throw err;
        }

        // We own the claimed file — read and return the envelope.
        const content = await readFile(claimedPath, 'utf8');
        return JSON.parse(content) as Envelope;
      }

      // All candidates were claimed by concurrent callers.
      return null;
    },

    // ── ack ──────────────────────────────────────────────────────────────────

    async ack(e: Envelope): Promise<void> {
      await unlink(join(dir, claimedName(e)));
    },

    // ── release ──────────────────────────────────────────────────────────────

    async release(e: Envelope): Promise<void> {
      await rename(join(dir, claimedName(e)), join(dir, pendingName(e)));
    },

    // ── list ─────────────────────────────────────────────────────────────────

    async list(): Promise<Envelope[]> {
      await mkdir(dir, { recursive: true });
      const entries = await readdir(dir);
      const pendingFiles = entries.filter((f) => f.endsWith('.json')).sort();

      const envelopes: Envelope[] = [];
      for (const filename of pendingFiles) {
        let content: string;
        try {
          content = await readFile(join(dir, filename), 'utf8');
        } catch {
          // File disappeared between readdir and readFile (concurrent claim/ack).
          continue;
        }
        envelopes.push(JSON.parse(content) as Envelope);
      }
      return envelopes;
    },

    // ── remove ───────────────────────────────────────────────────────────────

    async remove(e: Envelope): Promise<void> {
      try {
        await unlink(join(dir, pendingName(e)));
      } catch (err: unknown) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code !== 'ENOENT') throw err;
      }
    },
  };
}
