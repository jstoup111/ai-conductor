/**
 * Built-in local memory provider (ADR-015, FR-8/FR-9).
 *
 * The `local` provider is the default memory_provider: it backs memory with the
 * project-local `.memory/` directory (a symlink to the canonical shared store
 * after migration — ADR-017). It requires no MCP server, no service, and no
 * credentials (FR-8). Recall is performed by the agent reading the store and
 * judging relevance; the harness contains NO search, ranking, or relevance logic
 * for this provider (FR-3 invariant).
 *
 * This is a REAL provider object, never a null/empty case (condition C1). Future
 * non-default providers integrate as MCP servers the agent queries directly.
 */
export const LocalMemoryProvider = {
  /** Plugin kind — identifies this as a memory provider. */
  kind: 'memory_provider' as const,

  /** Provider name — used as the registry key. */
  name: 'local' as const,
} as const;

export type LocalMemoryProviderType = typeof LocalMemoryProvider;
