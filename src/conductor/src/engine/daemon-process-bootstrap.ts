import type { ConductorEventEmitter } from '../ui/events.js';
import {
  createBotCoAuthorResolver,
  installDaemonBotCoAuthor,
} from './bot-co-author.js';
import type { GithubBotCredential, GithubBotToken } from './github-bot-credential.js';
import { makeProductionGh, type GhRunner } from './tracker-client.js';

export interface DaemonProcessServicesOptions {
  readonly projectRoot: string;
  readonly events: ConductorEventEmitter;
  readonly runner?: GhRunner;
  readonly readCredential?: () => Promise<GithubBotCredential>;
  readonly readToken?: (path: string) => Promise<GithubBotToken>;
}

/** Install daemon-wide services that must be available before feature dispatch. */
export function installDaemonProcessServices({
  projectRoot,
  events,
  runner = makeProductionGh(),
  readCredential,
  readToken,
}: DaemonProcessServicesOptions): void {
  installDaemonBotCoAuthor(createBotCoAuthorResolver({
    runner,
    cwd: projectRoot,
    events,
    readCredential,
    readToken,
  }));
}
