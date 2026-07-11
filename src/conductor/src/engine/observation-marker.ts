// observation-marker.ts — Parser for `.docs/observation/<plan-stem>.md` markers.
//
// The observation marker format specifies how the daemon should watch for fixes
// becoming observable in production. Markers are authored at spec time and govern
// ship-time enrollment (when does a fix get added to the watch registry) and sweep
// behavior (how are matches detected, when is an issue closed).
//
// Format:
// ```
// Signature: <substring or /regex/>
// Surface: daemon-log
// Window-days: <number>
// ```
//
// Parsed results are typed discriminated unions (no throws beyond the module boundary):
// - ObservationDeclaration (watched): the marker parses cleanly
// - ParseError: malformed or invalid marker
//
// Line-oriented parsing mirrors intake-marker.ts style. Regex validation happens
// at parse time — an invalid regex pattern fails the parse with a typed error.

import * as fs from 'fs/promises';
import * as path from 'path';

/** Logger interface for diagnostic output. */
export interface Logger {
  warn(msg: string): void;
}

/**
 * Watched declaration: the marker parsed cleanly and specifies production observation.
 */
export interface WatchedDeclaration {
  kind: 'watched';
  /** Signature pattern: for regex, the pattern is stored without the /.../ delimiters. */
  signature: string;
  /** True if signature is a regex pattern; false for substring. */
  isRegex: boolean;
  /** Number of days to watch after merge before flagging as no-show. */
  windowDays: number;
  /** Currently 'daemon-log'; v1 supports only daemon-log surface. */
  surface: 'daemon-log';
}

/**
 * Close-on-merge declaration: the marker specifies that an issue should close on merge.
 */
export interface CloseOnMergeDeclaration {
  kind: 'close-on-merge';
  /** Justification for why closing on merge is safe. */
  rationale: string;
}

/**
 * Parse error: the marker is malformed or contains invalid data.
 */
export interface ParseError {
  kind: 'parse_error';
  message: string;
}

/**
 * Result type for parsing: either a valid declaration or a typed error.
 */
export type ObservationDeclaration = WatchedDeclaration | CloseOnMergeDeclaration;
export type ParseResult = ObservationDeclaration | ParseError;

/**
 * Parse `.docs/observation/<plan-stem>.md` marker content into a typed declaration.
 *
 * Supports two marker kinds:
 *
 * **Watched mode (default or Kind: watched):**
 * Requires:
 * - `Signature:` line with either a substring or /regex/ pattern
 * - `Surface:` line with value `daemon-log` (only v1 surface)
 * - `Window-days:` line with a positive integer
 *
 * **Close-on-merge mode (Kind: close-on-merge):**
 * Requires:
 * - `Rationale:` line with justification for safe merge-time closure
 *
 * For regex signatures (delimited by `/`), validates that the regex compiles
 * and stores the pattern without the delimiters.
 * Returns a typed ParseError if any required field is missing, malformed, or invalid.
 */
export function parseObservationMarker(content: string): ParseResult {
  const lines = content.split('\n');
  const fields: Record<string, string> = {};

  // Parse line-oriented key: value pairs
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z\-]+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      fields[key] = value.trim();
    }
  }

  // Detect marker kind: close-on-merge or watched (default)
  const kind = fields['Kind'];
  if (kind === 'close-on-merge') {
    return parseCloseOnMerge(fields);
  }

  // Default to watched mode
  return parseWatched(fields);
}

/**
 * Parse a close-on-merge marker.
 * Requires: Rationale field
 */
function parseCloseOnMerge(fields: Record<string, string>): ParseResult {
  const rationale = fields['Rationale'];
  if (!rationale) {
    return {
      kind: 'parse_error',
      message: 'Missing required field: Rationale',
    };
  }

  return {
    kind: 'close-on-merge',
    rationale,
  };
}

/**
 * Parse a watched marker.
 * Requires: Signature, Surface, Window-days
 */
function parseWatched(fields: Record<string, string>): ParseResult {
  // Validate and extract Signature
  const signatureRaw = fields['Signature'];
  if (!signatureRaw) {
    return {
      kind: 'parse_error',
      message: 'Missing required field: Signature',
    };
  }

  // Detect regex vs substring and extract the pattern
  const isRegex = signatureRaw.startsWith('/') && signatureRaw.endsWith('/');
  let signature = signatureRaw;
  if (isRegex) {
    // Extract pattern without the /.../ delimiters
    const pattern = signatureRaw.slice(1, -1);
    // Validate that the regex compiles
    try {
      new RegExp(pattern);
    } catch (err) {
      return {
        kind: 'parse_error',
        message: `Invalid regex in Signature: ${(err as Error).message}`,
      };
    }
    signature = pattern;
  }

  // Validate and extract Surface
  const surface = fields['Surface'];
  if (!surface) {
    return {
      kind: 'parse_error',
      message: 'Missing required field: Surface',
    };
  }
  if (surface !== 'daemon-log') {
    return {
      kind: 'parse_error',
      message: `Unknown Surface: ${surface} (v1 supports only daemon-log)`,
    };
  }

  // Validate and extract Window-days
  const windowDaysStr = fields['Window-days'];
  if (!windowDaysStr) {
    return {
      kind: 'parse_error',
      message: 'Missing required field: Window-days',
    };
  }
  const windowDays = parseInt(windowDaysStr, 10);
  if (isNaN(windowDays) || windowDays <= 0) {
    return {
      kind: 'parse_error',
      message: `Invalid Window-days: ${windowDaysStr} (must be a positive integer)`,
    };
  }

  // All fields valid — return a watched declaration
  return {
    kind: 'watched',
    signature,
    isRegex,
    windowDays,
    surface: 'daemon-log',
  };
}

/**
 * Read and parse an observation marker from `.docs/observation/<slug>.md`.
 *
 * Returns:
 * - ObservationDeclaration if the file exists and parses cleanly
 * - undefined if the file is missing (silently; missing files are expected)
 * - undefined if the file is malformed (logs warning with parse error details)
 *
 * Never throws beyond the module boundary.
 */
export async function readObservationDeclaration(
  worktreePath: string,
  slug: string,
  log?: Logger,
): Promise<ObservationDeclaration | undefined> {
  try {
    const markerPath = path.join(worktreePath, '.docs', 'observation', `${slug}.md`);
    const content = await fs.readFile(markerPath, 'utf-8');
    const result = parseObservationMarker(content);

    if (result.kind === 'parse_error') {
      log?.warn(
        `observation marker at ${markerPath} has parse error: ${result.message}`,
      );
      return undefined;
    }

    return result;
  } catch (err) {
    // File not found or other read error — return undefined silently
    // (missing files are expected when observation is not declared)
    return undefined;
  }
}
