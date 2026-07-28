import type { SessionManager } from '../execution/session.js';
import { v4 as uuidv4 } from 'uuid';

export interface ProviderSession {
  id: string;
  created: boolean;
}

export interface ProviderSessionInvocation {
  id: string;
  resume: boolean;
}

interface LegacySessionMirror {
  providerKey: string;
  session: SessionManager;
}

export interface ProviderSessionStoreOptions {
  createSessionId?: () => string;
  legacy?: LegacySessionMirror;
}

export class ProviderSessionScope {
  private readonly sessions = new Map<string, ProviderSession>();

  constructor(
    private readonly createSessionId: () => string,
    private readonly legacy?: LegacySessionMirror,
  ) {}

  async create(providerKey: string): Promise<ProviderSession> {
    const existing = this.sessions.get(providerKey);
    if (existing) return { ...existing };

    const session = { id: this.createSessionId(), created: false };
    this.sessions.set(providerKey, session);
    if (this.legacy?.providerKey === providerKey) {
      await this.legacy.session.recordCompatibilitySession(session.id, false);
    }
    return { ...session };
  }

  async prepare(providerKey: string): Promise<ProviderSessionInvocation> {
    return this.replace(providerKey);
  }

  async replace(providerKey: string): Promise<ProviderSessionInvocation> {
    this.sessions.delete(providerKey);
    const session = await this.create(providerKey);
    return { id: session.id, resume: false };
  }

  async markCreated(providerKey: string): Promise<void> {
    const session = this.sessions.get(providerKey);
    if (!session) {
      throw new Error(`Provider session not created for current scope: ${providerKey}`);
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

export class ProviderSessionStore {
  private readonly createSessionId: () => string;
  private readonly legacy?: LegacySessionMirror;
  private activeStep?: ProviderSessionScope;

  constructor(options: ProviderSessionStoreOptions = {}) {
    this.createSessionId = options.createSessionId ?? uuidv4;
    this.legacy = options.legacy;
  }

  async beginStep(_stepLabel: string): Promise<void> {
    await this.legacy?.session.clearCompatibilityCreatedMarker();
    this.activeStep = new ProviderSessionScope(this.createSessionId, this.legacy);
  }

  beginBranch(_stepLabel: string): ProviderSessionScope {
    return new ProviderSessionScope(this.createSessionId);
  }

  async create(providerKey: string): Promise<ProviderSession> {
    return this.step().create(providerKey);
  }

  async prepare(providerKey: string): Promise<ProviderSessionInvocation> {
    return this.step().prepare(providerKey);
  }

  async replace(providerKey: string): Promise<ProviderSessionInvocation> {
    return this.step().replace(providerKey);
  }

  async markCreated(providerKey: string): Promise<void> {
    await this.step().markCreated(providerKey);
  }

  current(providerKey: string): ProviderSession | undefined {
    return this.activeStep?.current(providerKey);
  }

  private step(): ProviderSessionScope {
    if (!this.activeStep) {
      throw new Error('ProviderSessionStore.beginStep must be called first');
    }
    return this.activeStep;
  }
}
