/** `FR-<n>` ids declared under a PRD's `## Functional Requirements` heading. */
export function extractPrdFrIds(prdText: string | null): Set<string> {
  const ids = new Set<string>();
  if (!prdText) return ids;
  const headingIdx = prdText.search(/^##\s+Functional Requirements\s*$/im);
  if (headingIdx === -1) return ids;
  const afterHeading = prdText.slice(headingIdx);
  const nextHeadingMatch = afterHeading.slice(1).match(/\n##\s+/);
  const section = nextHeadingMatch
    ? afterHeading.slice(0, nextHeadingMatch.index! + 1)
    : afterHeading;
  const frRe = /\bFR-\d+[A-Za-z]?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = frRe.exec(section)) !== null) {
    ids.add(m[0].toUpperCase());
  }
  return ids;
}
