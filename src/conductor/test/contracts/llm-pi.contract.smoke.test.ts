import './llm.contract.js';
import { defineLlmRealLeg } from './llm-real-leg.js';

const smokeCapability = 'credentialed:pi';
void smokeCapability;

defineLlmRealLeg('pi');
