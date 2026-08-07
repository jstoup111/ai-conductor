export type ScopedRunRunner = (command: string) => Promise<number>;

export interface ScopedRunCommandOptions {
  template: string;
  selectors: string[];
  runner: ScopedRunRunner;
}

export async function runScopedCommand({
  template,
  selectors,
  runner,
}: ScopedRunCommandOptions): Promise<number> {
  return runner(template.replace('{selectors}', selectors.join(' ')));
}
