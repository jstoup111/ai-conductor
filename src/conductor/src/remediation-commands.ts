/**
 * The only inline commands remediation guidance may offer to an operator.
 * Keeping this union closed makes each rendered command independently
 * parseable by the CLI proof in remediation-commands.test.ts.
 */
export type RemediationCommand =
  | { readonly kind: 'inline-run'; readonly feature?: string }
  | { readonly kind: 'inline-reset'; readonly feature?: string }
  | { readonly kind: 'inline-status'; readonly feature?: string }
  | { readonly kind: 'inline-fresh'; readonly feature?: string };

/** Every command shape is exercised through the real inline CLI parser. */
export const REMEDIATION_COMMAND_FIXTURES: readonly RemediationCommand[] = Object.freeze([
  { kind: 'inline-run' },
  { kind: 'inline-run', feature: 'add login' },
  { kind: 'inline-reset' },
  { kind: 'inline-reset', feature: 'add login' },
  { kind: 'inline-status' },
  { kind: 'inline-status', feature: 'add login' },
  { kind: 'inline-fresh' },
  { kind: 'inline-fresh', feature: 'add login' },
]);

/** Returns argv after the `ai-conductor` binary name. */
export function remediationArgv(command: RemediationCommand): string[] {
  const args = ['inline'];
  switch (command.kind) {
    case 'inline-run':
      break;
    case 'inline-reset':
      args.push('--reset');
      break;
    case 'inline-status':
      args.push('--status');
      break;
    case 'inline-fresh':
      args.push('--fresh');
      break;
  }
  if (command.feature) args.push(command.feature);
  return args;
}

function shellQuote(token: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(token)
    ? token
    : `"${token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Formats an operator-facing remediation command from its tokenized form. */
export function formatRemediationCommand(command: RemediationCommand): string {
  return ['ai-conductor', ...remediationArgv(command)].map(shellQuote).join(' ');
}
