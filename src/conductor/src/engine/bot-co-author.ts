import type { ConductorEventEmitter } from '../ui/events.js';
import type { ConductorEvent } from '../types/events.js';
import { readGithubBotCredential, readGithubBotToken, type GithubBotCredential, type GithubBotToken } from './github-bot-credential.js';
import { runBotIdentityRead, type GhRunner } from './tracker-client.js';

export type BotCoAuthorResult =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'resolved'; readonly login: string; readonly id: number; readonly trailer: string }
  | { readonly kind: 'unavailable'; readonly reason: 'token-unavailable' | 'identity-read-failed' };

export interface BotCoAuthorResolver {
  prepare(events?: ConductorEventEmitter): Promise<BotCoAuthorResult>;
  current(): BotCoAuthorResult | undefined;
}

const LOGIN = /^(?=.{1,39}$)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export function formatBotCoAuthorSkipped(event: Extract<ConductorEvent, { type: 'bot_co_author_skipped' }>): string {
  switch (event.reason) {
    case 'token-unavailable': return 'bot co-author skipped: token unavailable';
    case 'identity-read-failed': return 'bot co-author skipped: identity read failed';
    case 'worktree-write-failed': return 'bot co-author skipped: worktree setup failed';
  }
}

export function createBotCoAuthorResolver(input: { runner: GhRunner; cwd: string; events?: ConductorEventEmitter; readCredential?: () => Promise<GithubBotCredential>; readToken?: (path: string) => Promise<GithubBotToken> }): BotCoAuthorResolver {
  const readCredential = input.readCredential ?? readGithubBotCredential;
  const readToken = input.readToken ?? readGithubBotToken;
  let last: BotCoAuthorResult | undefined;
  let cachedTokenFile: string | undefined;
  return {
    async prepare(events = input.events): Promise<BotCoAuthorResult> {
      const credential = await readCredential();
      if (credential.kind === 'unconfigured') return (last = { kind: 'unconfigured' });
      if (cachedTokenFile === credential.tokenFile && last?.kind === 'resolved') return last;
      if ((await readToken(credential.tokenFile)).kind === 'unavailable') {
        last = { kind: 'unavailable', reason: 'token-unavailable' };
        await events?.emit({ type: 'bot_co_author_skipped', reason: 'token-unavailable' });
        return last;
      }
      try {
        const raw = await runBotIdentityRead(input.runner, input.cwd);
        const identity: unknown = JSON.parse(raw);
        const login = typeof identity === 'object' && identity !== null ? (identity as { login?: unknown }).login : undefined;
        const id = typeof identity === 'object' && identity !== null ? (identity as { id?: unknown }).id : undefined;
        if (typeof login !== 'string' || !LOGIN.test(login) || typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) throw new Error('invalid bot identity');
        cachedTokenFile = credential.tokenFile;
        return (last = { kind: 'resolved', login, id, trailer: `Co-authored-by: ${login} <${id}+${login}@users.noreply.github.com>` });
      } catch (error) {
        const reason = error instanceof Error && error.name === 'GithubBotAuthRefusalError' ? 'token-unavailable' : 'identity-read-failed';
        last = { kind: 'unavailable', reason };
        await events?.emit({ type: 'bot_co_author_skipped', reason });
        return last;
      }
    },
    current: () => last,
  };
}

let installedResolver: BotCoAuthorResolver | undefined;
export function installDaemonBotCoAuthor(resolver: BotCoAuthorResolver | undefined): void { installedResolver = resolver; }
export function daemonBotCoAuthorResolver(): BotCoAuthorResolver | undefined { return installedResolver; }

export function withDaemonCoAuthorTrailer(message: string): string {
  const current = installedResolver?.current();
  if (current?.kind !== 'resolved' || message.split('\n').includes(current.trailer)) return message;
  return `${message}\n\n${current.trailer}`;
}
