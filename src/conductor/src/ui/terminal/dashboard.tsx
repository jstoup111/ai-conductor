import React from 'react';
import { Box, Text } from 'ink';
import type { ConductState, StepDefinition } from '../../types/index.js';

export interface DashboardProps {
  state: ConductState;
  steps: StepDefinition[];
  featureName?: string;
  projectName?: string;
  branchName?: string;
  runMode?: string;
  elapsedSeconds?: number;
}

export function getStatusIcon(status: string): { icon: string; color: string } {
  switch (status) {
    case 'done': return { icon: '\u2713', color: 'green' };
    case 'in_progress': return { icon: '\u25B6', color: 'yellow' };
    case 'skipped': return { icon: '\u2192', color: 'cyan' };
    case 'stale': return { icon: '\u26A0', color: 'yellow' };
    case 'failed': return { icon: '\u2717', color: 'red' };
    default: return { icon: '\u2B1A', color: 'gray' };
  }
}

export function Dashboard({
  state,
  steps,
  featureName,
  projectName,
  branchName,
  runMode,
  elapsedSeconds,
}: DashboardProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        {featureName && <Text bold>Feature: {featureName}</Text>}
        {projectName && <Text>Project: {projectName}</Text>}
        {branchName && <Text>Branch: {branchName}</Text>}
        {runMode && <Text>Mode: {runMode}</Text>}
      </Box>

      <Box flexDirection="column">
        {steps.map((step) => {
          const stepStatus = state[step.name] ?? 'pending';
          const { icon, color } = getStatusIcon(stepStatus);
          const isActive = stepStatus === 'in_progress';

          return (
            <Box key={step.name}>
              <Text color={color}>{icon}</Text>
              <Text> </Text>
              <Text>{step.label}</Text>
              <Text dimColor> [{step.phase}]</Text>
              {isActive && elapsedSeconds !== undefined && (
                <Text dimColor> ({elapsedSeconds}s)</Text>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
