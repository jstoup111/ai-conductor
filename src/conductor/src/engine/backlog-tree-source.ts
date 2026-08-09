/**
 * Read-only view of the committed backlog artifact tree.
 *
 * This contract is shared by shipped-record readers and daemon discovery, but
 * deliberately contains no daemon orchestration or git mutation behavior.
 */
export interface BacklogTreeSource {
  listPlanFiles(): Promise<string[]>;
  listShippedFiles(): Promise<string[]>;
  listAdrFiles(): Promise<string[]>;
  readFile(relPath: string): Promise<string | null>;
}
