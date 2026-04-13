import React from 'react';
import { Box, Text } from 'ink';
import type { Phase } from '../../types/index.js';

export interface NavigationStep {
  name: string;
  label: string;
  status: string;
  phase: Phase;
}

export interface NavigationProps {
  steps: NavigationStep[];
  onSelect: (stepIndex: number) => void;
}

export function Navigation({ steps }: NavigationProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Navigate to step:</Text>
      <Box flexDirection="column" marginTop={1}>
        {steps.map((step, idx) => (
          <Text key={step.name}>
            <Text bold>{idx + 1}</Text>
            <Text> {step.label}</Text>
            <Text dimColor> [{step.status}]</Text>
            <Text dimColor> [{step.phase}]</Text>
          </Text>
        ))}
        <Text>
          <Text bold>0</Text>
          <Text> Cancel</Text>
        </Text>
      </Box>
    </Box>
  );
}
