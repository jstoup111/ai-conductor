/**
 * Engine-authored PR-body provenance and control markers.
 *
 * This module deliberately has no imports: consumers on both sides of the
 * template-region parser can re-export these literals without creating an
 * initialization cycle.
 */
export const PR_BODY_FLOOR_MARKER = '<!-- conductor:pr-body-floor -->';
export const NEEDS_REMEDIATION_BODY_MARKER = '<!-- conductor:needs-remediation -->';
export const HALT_PR_BANNER_SENTINEL =
  'This PR was opened automatically after an irrecoverable daemon HALT.';

/**
 * Replace opaque project-owned regions with same-length whitespace so engine
 * signal searches never interpret region content (ADR D6). Lives here, in the
 * import-free leaf, so every signal reader can use it without a cycle.
 */
export function maskProjectOwnedRegions(body: string): string {
  return body.replace(/<!-- ai-conductor:step [^\r\n]+ -->[\s\S]*?<!-- \/ai-conductor:step -->/g, (region) =>
    region.replace(/[^\r\n]/g, ' '));
}

/** True when `needle` occurs in engine-owned body text (outside every project-owned region). */
export function engineBodyIncludes(body: string, needle: string): boolean {
  return maskProjectOwnedRegions(body).includes(needle);
}

/**
 * Remove the first engine-owned occurrence of `needle`, never touching bytes
 * inside a project-owned region. Masking preserves offsets, so the masked
 * index addresses the same bytes in the original body.
 */
export function removeEngineBodyMarker(body: string, needle: string): string {
  const index = maskProjectOwnedRegions(body).indexOf(needle);
  if (index < 0) return body;
  return body.slice(0, index) + body.slice(index + needle.length);
}

/**
 * Split `body` into lines paired with their masked form, so line filters can
 * decide on engine-owned text while keeping region lines byte-for-byte.
 */
export function engineBodyLines(body: string): Array<{ line: string; masked: string }> {
  const lines = body.split('\n');
  const masked = maskProjectOwnedRegions(body).split('\n');
  return lines.map((line, i) => ({ line, masked: masked[i] ?? '' }));
}
