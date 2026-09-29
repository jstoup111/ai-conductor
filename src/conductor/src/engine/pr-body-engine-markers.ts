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
