import type { IngestionSource } from '../../types/contracts';

/** The only wearable sources allowed to reach AI prompts. Strava is export-only and absent. */
export const AI_SAFE_SOURCES: readonly IngestionSource[] = ['healthkit', 'health_connect', 'whoop'];

/** Throws if any record's source is not an allowed ingestion source. */
export function assertAiSafeSources(records: readonly { source: string }[]): void {
  for (const r of records) {
    if (!(AI_SAFE_SOURCES as readonly string[]).includes(r.source)) {
      throw new Error(`Source "${r.source}" is not AI-safe and cannot be used in prompts`);
    }
  }
}
