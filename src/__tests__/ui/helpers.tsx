import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { createDrillEngine, createMockPoseStream } from '../../domain';
import { CONSENT_POLICY_VERSION, type DrillResult, type DrillType } from '../../types/contracts';
import { AppStateProvider, useAppState, type AppStateProviderProps } from '../../state/AppStateContext';
import { AppNavigator } from '../../navigation/AppNavigator';
import type { RouteName } from '../../navigation/NavigationContext';

export const FIXED_NOW = new Date(2026, 10, 22, 12, 0, 0);
export const fixedNow = (): Date => FIXED_NOW;

/** Runs the real engine over the deterministic mock stream until the drill completes. */
export function simulateResult(type: DrillType, seed = 7): DrillResult {
  const engine = createDrillEngine(type);
  const stream = createMockPoseStream({ scenario: type, seed });
  for (let i = 0; i < 5000; i += 1) {
    const snap = engine.push(stream.next());
    if (snap.phase === 'complete') break;
  }
  const metrics = engine.result();
  if (!metrics) throw new Error('simulated drill did not complete');
  return { id: `test-${type}`, sport: 'soccer', drillType: type, startedAt: FIXED_NOW.toISOString(), metrics };
}

export const CAMERA_CONSENT = {
  type: 'camera_skeletal_tracking',
  policyVersion: CONSENT_POLICY_VERSION,
  grantedAt: FIXED_NOW.toISOString(),
} as const;

function Seed({ results }: { results: readonly DrillResult[] }) {
  const { completeDrill } = useAppState();
  useEffect(() => {
    results.forEach(completeDrill);
    // seed once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Exposes provider state as text for assertions. */
export function Probe() {
  const s = useAppState();
  return (
    <Text testID="probe">
      {JSON.stringify({
        age: s.ageBracket,
        visibility: s.visibility,
        consents: s.consents.map((c) => c.type),
        persona: s.persona,
        position: s.position,
      })}
    </Text>
  );
}

export function renderApp(
  ui: React.ReactElement,
  props: Partial<AppStateProviderProps> & { seed?: readonly DrillResult[] } = {},
) {
  const { seed, ...rest } = props;
  return render(
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppStateProvider now={fixedNow} {...rest}>
        {seed ? <Seed results={seed} /> : null}
        {ui}
      </AppStateProvider>
    </SafeAreaProvider>,
  );
}

export function renderNavigator(
  props: Partial<AppStateProviderProps> & { seed?: readonly DrillResult[]; initialRoute?: RouteName } = {},
) {
  const { initialRoute, ...rest } = props;
  return renderApp(
    <>
      <Probe />
      <AppNavigator {...(initialRoute ? { initialRoute } : {})} />
    </>,
    rest,
  );
}
