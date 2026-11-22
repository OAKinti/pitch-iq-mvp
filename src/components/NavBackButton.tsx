import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '../navigation/NavigationContext';
import { HudButton } from './HudPrimitives';
import { spacing } from '../theme/tokens';

/** Small HUD back button; renders nothing on the root screen. */
export function NavBackButton() {
  const { canGoBack, goBack } = useNavigation();
  if (!canGoBack) return null;
  return (
    <View style={styles.wrap}>
      <HudButton testID="nav-back" label="Back" variant="ghost" onPress={goBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start', marginLeft: -spacing.xl },
});
