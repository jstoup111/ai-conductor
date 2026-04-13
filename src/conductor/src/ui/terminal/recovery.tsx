import React from 'react';
import { Box, Text } from 'ink';
import type { RecoveryOption } from '../../types/index.js';

export interface RecoveryProps {
  stepName: string;
  options: RecoveryOption[];
  onChoice: (choice: RecoveryOption) => void;
}

const OPTION_LABELS: Record<RecoveryOption, { key: string; label: string; color: string }> = {
  retry: { key: 'r', label: 'retry', color: 'green' },
  interactive: { key: 'i', label: 'interactive fix', color: 'cyan' },
  back: { key: 'b', label: 'go back', color: 'yellow' },
  skip: { key: 's', label: 'skip', color: 'magenta' },
  quit: { key: 'q', label: 'quit', color: 'red' },
};

export function Recovery({ stepName, options }: RecoveryProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Recovery: {stepName}</Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt) => {
          const { key, label, color } = OPTION_LABELS[opt];
          return (
            <Text key={opt}>
              <Text color={color} bold>{key}</Text>
              <Text> = {label}</Text>
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
