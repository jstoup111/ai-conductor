export interface InvokeResult {
  success: boolean;
  output: string;
  exitCode: number;
  rateLimited?: boolean;
  sessionExpired?: boolean;
}

export interface InvokeOptions {
  prompt: string;
  systemPrompt?: string;
  sessionId: string;
  resume: boolean;
  interactive?: boolean;
  dangerouslySkipPermissions?: boolean;
  stepCooldown?: number;
  sessionName?: string;
}

export interface LLMProvider {
  invoke(options: InvokeOptions): Promise<InvokeResult>;
  invokeInteractive(options: InvokeOptions): Promise<void>;
}
