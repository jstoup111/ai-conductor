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
