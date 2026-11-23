import type { DrillResult, IngestionSource, WearableDailySummary } from '../../types/contracts';

export interface IngestionAdapter {
  readonly source: IngestionSource;
  isAvailable(): Promise<boolean>;
  fetchDailySummaries(fromDate: string, toDate: string): Promise<WearableDailySummary[]>;
}

export interface ExportAdapter {
  readonly destination: 'strava';
  exportDrill(result: DrillResult): Promise<{ remoteId: string | null }>;
}
