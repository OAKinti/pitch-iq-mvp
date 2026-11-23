import { createContext, useContext } from 'react';

export type RouteName = 'Onboarding' | 'Combine' | 'OVRCard' | 'GroupSession' | 'HighlightShare';

export interface Navigation {
  navigate: (route: RouteName) => void;
  replace: (route: RouteName) => void;
  goBack: () => void;
  canGoBack: boolean;
}

export const NavigationContext = createContext<Navigation | null>(null);

export function useNavigation(): Navigation {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used inside AppNavigator');
  return ctx;
}
