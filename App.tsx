// Placeholder until Slice C is merged; replaced by the AppNavigator wiring.
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { colors } from './src/theme/tokens';

export default function App() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.textPrimary }}>PitchIQ — contracts frozen</Text>
      <StatusBar style="light" />
    </View>
  );
}
