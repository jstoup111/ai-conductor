// self-host/build-auth-message.ts — shared build-auth remediation message builder
//
// Task 7 (FR-5): a single builder for the human-readable remediation message
// shown whenever the daemon build-auth token is missing/unreadable/invalid.
// Consumed later by preflight (Task 8), CLI (Task 12), and daemon (Task 13)
// so all sites present identical, complete guidance instead of drifting
// inline copies.
//
// The message never includes token material — only the mint command and the
// resolved token PATH (never a value read from the file).

import { DAEMON_BUILD_TOKEN_MINT_COMMAND } from './daemon-build-token.js';

/**
 * Builds the shared build-auth remediation message.
 *
 * Includes:
 * - the command to mint a daemon build token
 * - the resolved token path (reflecting any config override), so operators
 *   know exactly where the daemon expects the file
 * - three known pitfalls: mint output may only print in an interactive
 *   terminal (tty-only), trailing whitespace can end up in the stored
 *   token, and file permission issues can make an existing token unreadable
 *
 * @param resolvedPath Absolute, resolved path to the daemon build token file.
 * @returns A remediation message string. Contains no token material.
 */
export function buildAuthRemediationMessage(resolvedPath: string): string {
  return [
    'The daemon build-auth token is missing, unreadable, or invalid.',
    '',
    `Run: ${DAEMON_BUILD_TOKEN_MINT_COMMAND}`,
    `This should create a token at: ${resolvedPath}`,
    '',
    'Common pitfalls:',
    '  - Mint output may only appear in an interactive terminal (tty). If you ' +
      'ran the mint command in a non-interactive shell or piped its output, ' +
      're-run it directly in an interactive terminal and confirm the token ' +
      'was written.',
    '  - Trailing whitespace: make sure the stored token file does not contain ' +
      'trailing whitespace or a stray newline appended by copy-paste; the ' +
      'daemon trims the file contents, but a corrupted or partial copy can ' +
      'still leave the token invalid.',
    '  - File permissions: verify the token file is readable by the daemon ' +
      'process (check owner/mode); a permission error will surface as an ' +
      'unreadable token even when the file exists.',
    '',
    'Then configure the path in your harness config under:',
    '  harness_self_host.build_auth:',
    '    token_path: <your_path>',
  ].join('\n');
}
