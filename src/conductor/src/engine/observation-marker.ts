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
 * Parse error: the marker is malformed or contains invalid data.
 */
export interface ParseError {
  kind: 'parse_error';
  message: string;
}

/**
 * Result type for parsing: either a valid declaration or a typed error.
 */
export type ParseResult = WatchedDeclaration | ParseError;

/**
 * Parse `.docs/observation/<plan-stem>.md` marker content into a typed declaration.
 *
 * Requires:
 * - `Signature:` line with either a substring or /regex/ pattern
 * - `Surface:` line with value `daemon-log` (only v1 surface)
 * - `Window-days:` line with a positive integer
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
