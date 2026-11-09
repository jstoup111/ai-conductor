import './llm.contract.js';
import { defineLlmRealLeg } from './llm-real-leg.js';

const smokeCapability = 'credentialed:codex';
void smokeCapability;

defineLlmRealLeg('codex');
