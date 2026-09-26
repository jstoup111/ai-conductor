import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { readUserConfig } from './user-config.js';

export type GithubBotCredential =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'configured'; readonly tokenFile: string };
export type GithubBotToken = { readonly kind: 'token'; readonly token: string } | { readonly kind: 'unavailable' };

export function resolveGithubBotCredential(userConfig: { github_bot?: { token_file?: unknown } }): GithubBotCredential {
  const tokenFile = userConfig.github_bot?.token_file;
  if (typeof tokenFile !== 'string' || tokenFile.trim() === '') return { kind: 'unconfigured' };
  const expanded = tokenFile === '~' || tokenFile.startsWith('~/')
    ? resolve(homedir(), tokenFile.slice(2))
    : resolve(tokenFile);
  return { kind: 'configured', tokenFile: expanded };
}

export async function readGithubBotToken(tokenFile: string): Promise<GithubBotToken> {
  try {
    const token = (await readFile(tokenFile, 'utf8')).trim();
    return token === '' ? { kind: 'unavailable' } : { kind: 'token', token };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function readGithubBotCredential(
  readUser: () => Promise<{ config: { github_bot?: { token_file?: unknown } } }> = readUserConfig,
): Promise<GithubBotCredential> {
  return resolveGithubBotCredential((await readUser()).config);
}
