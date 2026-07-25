import type { SessionManager } from '../execution/session.js';
import { v4 as uuidv4 } from 'uuid';

export interface ProviderSession {
  id: string;
  created: boolean;
}

export interface ProviderSessionStoreOptions {
  createSessionId?: () => string;
  legacy?: {
    providerKey: string;
    session: SessionManager;
  };
}

export class ProviderSessionStore {
  private readonly sessions = new Map<string, ProviderSession>();
  private readonly createSessionId: () => string;
  private readonly legacy?: ProviderSessionStoreOptions['legacy'];
  private stepActive = false;

  constructor(options: ProviderSessionStoreOptions = {}) {
    this.createSessionId = options.createSessionId ?? uuidv4;
    this.legacy = options.legacy;
  }

  async beginStep(_stepLabel: string): Promise<void> {
    this.sessions.clear();
    this.stepActive = true;
    await this.legacy?.session.clearCompatibilityCreatedMarker();
  }

  async create(providerKey: string): Promise<ProviderSession> {
    if (!this.stepActive) {
      throw new Error('ProviderSessionStore.beginStep must be called before create');
    }
    const existing = this.sessions.get(providerKey);
    if (existing) return { ...existing };

    const session = { id: this.createSessionId(), created: false };
    this.sessions.set(providerKey, session);
    if (this.legacy?.providerKey === providerKey) {
      await this.legacy.session.recordCompatibilitySession(session.id, false);
    }
    return { ...session };
  }

  async markCreated(providerKey: string): Promise<void> {
    const session = this.sessions.get(providerKey);
    if (!session) {
      throw new Error(`Provider session not created for current step: ${providerKey}`);
    }
    session.created = true;
    if (this.legacy?.providerKey === providerKey) {
      await this.legacy.session.recordCompatibilitySession(session.id, true);
    }
  }

  current(providerKey: string): ProviderSession | undefined {
    const session = this.sessions.get(providerKey);
    return session ? { ...session } : undefined;
  }
}
