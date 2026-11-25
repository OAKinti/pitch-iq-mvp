import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Linking } from 'react-native';
import { useAppState } from '../state/AppStateContext';
import { parseInviteUrl } from '../services/invites/inviteLink';
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
  const replace = useCallback(
    (route: RouteName) => setStack((s) => [...s.slice(0, -1), route]),
    [],
  );
  const goBack = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false;
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [canGoBack, goBack]);

  const { joinFromInvite, joinNotice } = useAppState();

  // D-9B: a pitchiq://join/<code> link (cold start or while running). One join per received URL.
  useEffect(() => {
    const handle = (url: string | null | undefined): void => {
      const code = url ? parseInviteUrl(url) : null;
      if (code) joinFromInvite(code);
    };
    Linking.getInitialURL()
      .then(handle)
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, [joinFromInvite]);

  // Show the Group screen whenever a join attempt resolves.
  const noticeSeq = joinNotice?.seq ?? 0;
  useEffect(() => {
    if (noticeSeq === 0) return;
    setStack((s) => (s[s.length - 1] === 'GroupSession' ? s : [...s, 'GroupSession']));
  }, [noticeSeq]);

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
