import type { IngestionAdapter } from './types';

/**
 * Day 1 stub.
 * TODO Day 2-3: implement with `react-native-health-connect` (Android Health Connect): read
 * RestingHeartRate, HeartRateVariabilityRmssd, SleepSession records; map to WearableDailySummary.
 */
export function createHealthConnectAdapter(): IngestionAdapter {
  return {
    source: 'health_connect',
    isAvailable: async () => false,
    fetchDailySummaries: async () => [],
  };
}
