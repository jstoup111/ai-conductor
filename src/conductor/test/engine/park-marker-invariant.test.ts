import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Single-writer invariant sweep (Task 12, FR-7 negative path).
//
// park-marker.ts is the single source of truth for the durable
// `.daemon/parked/<slug>` operator-park marker. writeOperatorPark() and
// removeOperatorPark() are the only functions permitted to create or delete
// that marker, and daemon-park-cli.ts (the `conduct park`/`conduct unpark`
// CLI handler) is the only consumer permitted to call them.
//
// Every other engine consumer (the daemon loop, the rekick sweep, the
// dashboard) must treat the marker as read-only, going through
// isOperatorParked()/listOperatorParkedSlugs() only. If any other module
// grew a write call or a hard-coded `.daemon/parked/` path, it would open a
// second, uncoordinated writer to the same file — which is exactly the kind
// of race that produces orphaned markers or a clobbered park that silently
// un-halts a repo the operator explicitly stopped. This test statically
// sweeps the source tree to guarantee that never regresses.
// ─────────────────────────────────────────────────────────────────────────────

const SRC_ROOT = join(__dirname, '..', '..', 'src');

// Files allowed to reference the marker path / write primitives directly.
const ALLOWED_FILES = new Set(['engine/park-marker.ts', 'engine/daemon-park-cli.ts']);

const HARD_CODED_PATH_RE = /\.daemon\/parked\//;
const WRITE_CALL_RE = /\b(writeOperatorPark|removeOperatorPark)\s*\(/;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

describe('operator-park single-writer invariant', () => {
  const files = listTsFiles(SRC_ROOT);

  it('scans more than a handful of source files (sanity check on the sweep itself)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('only park-marker.ts and daemon-park-cli.ts call writeOperatorPark/removeOperatorPark', () => {
    const violations: string[] = [];

    for (const file of files) {
      const relPath = relative(SRC_ROOT, file).split('\\').join('/');
      if (ALLOWED_FILES.has(relPath)) continue;

      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (WRITE_CALL_RE.test(line) && !isComment(line)) {
          violations.push(`${relPath}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('no hard-coded `.daemon/parked/` path literals exist outside park-marker.ts and daemon-park-cli.ts', () => {
    const violations: string[] = [];

    for (const file of files) {
      const relPath = relative(SRC_ROOT, file).split('\\').join('/');
      if (ALLOWED_FILES.has(relPath)) continue;

      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        // Comments referencing the marker path for documentation purposes are
        // fine — the invariant is about executable code, not prose.
        if (HARD_CODED_PATH_RE.test(line) && !isComment(line)) {
          violations.push(`${relPath}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('engine consumers only import read-path primitives from park-marker.ts', () => {
    const violations: string[] = [];
    const readOnlyImportRe = /from\s+['"].*park-marker(\.js)?['"]/;

    for (const file of files) {
      const relPath = relative(SRC_ROOT, file).split('\\').join('/');
      if (ALLOWED_FILES.has(relPath)) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (readOnlyImportRe.test(line) && !isComment(line)) {
          const importsWrite =
            /\bwriteOperatorPark\b/.test(line) || /\bremoveOperatorPark\b/.test(line);
          if (importsWrite) {
            violations.push(`${relPath}:${idx + 1}: ${line.trim()}`);
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
