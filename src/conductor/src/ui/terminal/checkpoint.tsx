import React from 'react';
import { Box, Text } from 'ink';

export interface CheckpointProps {
  stepName: string;
  onChoice: (choice: 'continue' | 'back' | 'quit') => void;
}

export function Checkpoint({ stepName }: CheckpointProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Checkpoint: {stepName}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text color="green" bold>c</Text>
          <Text> = continue</Text>
        </Text>
        <Text>
          <Text color="yellow" bold>b</Text>
          <Text> = go back</Text>
        </Text>
        <Text>
          <Text color="red" bold>q</Text>
          <Text> = quit</Text>
        </Text>
      </Box>
    </Box>
  );
}
