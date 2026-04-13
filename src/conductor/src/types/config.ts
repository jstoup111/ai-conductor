import type { ComplexityTier, EnforcementLevel } from './steps.js';

export interface CustomStep {
  name: string;
  after: string;
  skill: string;
  enforcement: EnforcementLevel;
}

export interface HarnessConfig {
  harness_version?: string;
  steps?: {
    disable?: string[];
    add?: CustomStep[];
  };
  skills?: {
    overrides?: Record<string, string>;
    hooks?: Record<string, { before?: string; after?: string }>;
  };
  complexity?: {
    default_tier?: ComplexityTier;
  };
}
