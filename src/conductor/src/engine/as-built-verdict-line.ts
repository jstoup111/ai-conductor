/** The parsed contents of an as-built review's explicit verdict line. */
export type AsBuiltVerdictLine =
  | { found: false }
  | { found: true; raw: string; recognized: string | null };

/**
 * Read the `Verdict:` line of an as-built review report, retaining an
 * unrecognized value for diagnostics while keeping the recognized vocabulary
 * closed.
 */
export function readAsBuiltVerdictLine(content: string): AsBuiltVerdictLine {
  const m = content.match(
    /^[^\S\n]*(?:#{1,6}[^\S\n]+)?\*{0,2}\s*Verdict\s*\*{0,2}\s*:+\s*\*{0,2}\s*(.*?)\s*\*{0,2}(?:[^\S\n]+#{1,6})?\s*$/im,
  );
  if (!m) return { found: false };
  const raw = m[1].replace(/\*+/g, '').trim().toUpperCase();
  if (!raw) return { found: false };
  const recognized = raw === 'APPROVED' || raw === 'APPROVED WITH DRIFT NOTES' ||
      raw === 'PLAN_GAP' || raw === 'BLOCKED'
    ? raw
    : null;
  return { found: true, raw, recognized };
}
