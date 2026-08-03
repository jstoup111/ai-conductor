import { parseReleaseDisposition } from './release-metadata.js';

export interface ReleaseMetadataCheckActionInput {
  github: unknown;
  context: {
    payload: {
      pull_request: {
        body?: string | null;
      };
    };
  };
  core: {
    setOutput(name: string, value: string): void;
  };
}

/** Validate and normalize release metadata from the pull-request webhook payload. */
export async function runReleaseMetadataCheckAction(
  input: ReleaseMetadataCheckActionInput,
): Promise<void> {
  const disposition = parseReleaseDisposition(input.context.payload.pull_request.body ?? '');
  input.core.setOutput('release-disposition', JSON.stringify(disposition));
}
