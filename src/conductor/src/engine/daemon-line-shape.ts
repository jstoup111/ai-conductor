/** The indentation depth used for a daemon log line body. */
export type DaemonLogDepth = 0 | 1 | 2;

const MARKERS: Record<DaemonLogDepth, string> = {
  0: '',
  1: '· ',
  2: '·   ',
};

/**
 * Turn a daemon message into physical line bodies with one consistent shape.
 * The first body is left-aligned (without losing any leading ANSI SGR codes);
 * continuation bodies preserve their source content behind a continuation bar.
 */
export function composeDaemonLineBodies(message: string, depth: DaemonLogDepth): string[] {
  const lines = message.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  const marker = MARKERS[depth];
  return lines.map((line, index) => {
    if (index > 0) return line === '' ? `${marker}│` : `${marker}│ ${line}`;
    return `${marker}${stripLeadingWhitespace(line)}`;
  });
}

function stripLeadingWhitespace(line: string): string {
  const match = line.match(/^((?:\x1b\[[0-9;]*m)*)\s*/);
  if (!match) return line;
  return `${match[1]}${line.slice(match[0].length)}`;
}
