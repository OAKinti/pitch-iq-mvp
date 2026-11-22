import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';
import { NavigationContext, type Navigation, type RouteName } from './NavigationContext';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { CombineDrillScreen } from '../screens/CombineDrillScreen';
import { OVRCardScreen } from '../screens/OVRCardScreen';
import { GroupSessionScreen } from '../screens/GroupSessionScreen';
import { HighlightShareScreen } from '../screens/HighlightShareScreen';

export type { RouteName } from './NavigationContext';
export { useNavigation } from './NavigationContext';

const SCREENS: Record<RouteName, React.ComponentType> = {
  Onboarding: OnboardingScreen,
  Combine: CombineDrillScreen,
  OVRCard: OVRCardScreen,
  GroupSession: GroupSessionScreen,
  HighlightShare: HighlightShareScreen,
};

export function AppNavigator({ initialRoute = 'Onboarding' }: { initialRoute?: RouteName }) {
  const [stack, setStack] = useState<RouteName[]>([initialRoute]);
  const canGoBack = stack.length > 1;

  const navigate = useCallback((route: RouteName) => setStack((s) => [...s, route]), []);
  const replace = useCallback((route: RouteName) => setStack((s) => [...s.slice(0, -1), route]), []);
  const goBack = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false;
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [canGoBack, goBack]);

  const nav = useMemo<Navigation>(
    () => ({ navigate, replace, goBack, canGoBack }),
    [navigate, replace, goBack, canGoBack],
  );

  const route = stack[stack.length - 1] ?? initialRoute;
  const Screen = SCREENS[route];
  return (
    <NavigationContext.Provider value={nav}>
      <Screen key={route} />
    </NavigationContext.Provider>
  );
}
