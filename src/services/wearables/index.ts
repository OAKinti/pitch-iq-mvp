export type { IngestionAdapter, ExportAdapter } from './types';
export { createHealthKitAdapter } from './healthkit';
export { createHealthConnectAdapter } from './healthConnect';
export { createWhoopAdapter, mapWhoopRecovery } from './whoop';
export { assertAiSafeSources, AI_SAFE_SOURCES } from './aiSafety';
export {
  createStravaExportAdapter,
  buildStravaActivityPayload,
  STRAVA_CREATE_ACTIVITY_URL,
} from './stravaExport';
