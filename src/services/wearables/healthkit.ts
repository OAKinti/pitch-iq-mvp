import type { IngestionAdapter } from './types';

/**
 * Day 1 stub.
 * TODO Day 2-3: implement with `react-native-health` (iOS HealthKit): request read permissions
 * for RestingHeartRate, HeartRateVariability, SleepAnalysis; map samples to WearableDailySummary.
 */
export function createHealthKitAdapter(): IngestionAdapter {
  return {
    source: 'healthkit',
    isAvailable: async () => false,
    fetchDailySummaries: async () => [],
  };
}
