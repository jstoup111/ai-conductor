import './llm.contract.js';
import { defineLlmRealLeg } from './llm-real-leg.js';

const smokeCapability = 'credentialed:claude';
void smokeCapability;

defineLlmRealLeg('claude');
