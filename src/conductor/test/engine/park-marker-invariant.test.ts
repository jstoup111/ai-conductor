import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Single-writer invariant sweep (Task 12, FR-7 negative path).
//
// park-marker.ts is the canonical source of truth for the durable
// `.daemon/parked/<slug>` operator-park marker. The guarded
// park-reconciliation helper is the only additional deletion path permitted
// to participate in that lifecycle; its preconditions and ordering are
// verified by park-reconciliation.test.ts.
//
// Every other engine consumer (including reconciliation sweep code, the daemon
// loop, the rekick sweep, and the dashboard) must treat the marker as
// read-only, going through
// isOperatorParked()/listOperatorParkedSlugs() only. If any other module
// grew a write call or a hard-coded `.daemon/parked/` path, it would open a
// second, uncoordinated writer to the same file — which is exactly the kind
// of race that produces orphaned markers or a clobbered park that silently
// un-halts a repo the operator explicitly stopped. This test statically
// sweeps the source tree to guarantee that never regresses.
// ─────────────────────────────────────────────────────────────────────────────

const SRC_ROOT = join(__dirname, '..', '..', 'src');

const CANONICAL_MARKER_MODULE = 'engine/park-marker.ts';
const GUARDED_RECONCILIATION_HELPER = 'engine/park-reconciliation.ts';

// Only these modules may contain executable references to the durable marker
// path. The helper is deliberately named here: a future sweep implementation
// must not acquire its own marker-writing path.
const ALLOWED_MARKER_PATH_FILES = new Set([
  CANONICAL_MARKER_MODULE,
  GUARDED_RECONCILIATION_HELPER,
]);

// The CLI remains the canonical adapter for the operator park/unpark verbs;
// reconciliation reaches it through dispatchDaemonPark rather than importing
// marker write primitives directly.
const ALLOWED_WRITE_CALL_FILES = new Set([CANONICAL_MARKER_MODULE, 'engine/daemon-park-cli.ts']);

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

function markerPathViolations(
  entries: Array<{ relPath: string; content: string }>,
): string[] {
  const violations: string[] = [];

  for (const { relPath, content } of entries) {
    if (ALLOWED_MARKER_PATH_FILES.has(relPath)) continue;

    content.split('\n').forEach((line, idx) => {
      if (HARD_CODED_PATH_RE.test(line) && !isComment(line)) {
        violations.push(`${relPath}:${idx + 1}: ${line.trim()}`);
      }
    });
  }

  return violations;
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
      if (ALLOWED_WRITE_CALL_FILES.has(relPath)) continue;

      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (WRITE_CALL_RE.test(line) && !isComment(line)) {
          violations.push(`${relPath}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('allows marker-path access only in the canonical module and guarded reconciliation helper', () => {
    const entries = files.map((file) => ({
      relPath: relative(SRC_ROOT, file).split('\\').join('/'),
      content: readFileSync(file, 'utf8'),
    }));

    expect(markerPathViolations(entries)).toEqual([]);
  });

  it('rejects a mutation that adds a marker writer outside the guarded helper', () => {
    const violations = markerPathViolations([
      {
        relPath: 'engine/reconcile-parked-sweep.ts',
        content: "const marker = '.daemon/parked/rogue';",
      },
    ]);

    expect(violations).toEqual([
      "engine/reconcile-parked-sweep.ts:1: const marker = '.daemon/parked/rogue';",
    ]);
  });

  it('engine consumers only import read-path primitives from park-marker.ts', () => {
    const violations: string[] = [];
    const readOnlyImportRe = /from\s+['"].*park-marker(\.js)?['"]/;

    for (const file of files) {
      const relPath = relative(SRC_ROOT, file).split('\\').join('/');
      if (ALLOWED_WRITE_CALL_FILES.has(relPath)) continue;

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
