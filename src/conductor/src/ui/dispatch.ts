import type { ConductorEvent } from '../types/index.js';
import type { UIRenderer } from './types.js';

/**
 * Dispatch a ConductorEvent to all registered renderers concurrently.
 * Each renderer's handle() runs in parallel via Promise.all.
 * A renderer that throws is isolated — its error is caught and re-emitted as
 * a renderer_error event to the remaining renderers so the UI can surface it
 * without crashing the pipeline.
 *
 * If no renderers are registered, this is a no-op.
 */
export async function dispatchRenderers(
  renderers: UIRenderer[],
  event: ConductorEvent,
): Promise<void> {
  if (renderers.length === 0) return;

  const results = await Promise.allSettled(
    renderers.map((r) => r.handle(event)),
  );

  // Collect any renderer failures and re-dispatch renderer_error to healthy renderers.
  const failedNames: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      const rendererName = (renderers[i] as { name?: string }).name ?? `renderer[${i}]`;
      failedNames.push(rendererName);
      const errEvent: ConductorEvent = {
        type: 'renderer_error',
        rendererName,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
      // Notify surviving renderers — fire-and-forget, don't await to avoid cascade.
      for (let j = 0; j < renderers.length; j++) {
        if (j !== i) {
          renderers[j].handle(errEvent).catch(() => {});
        }
      }
    }
  }
}
