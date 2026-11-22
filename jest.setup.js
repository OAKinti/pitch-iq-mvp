/* global jest */
// Reanimated 4: package.json "resolver" routes worklets to their JS implementation;
// the mock makes animations resolve synchronously.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
// Safe-area: provide fixed insets/frame so SafeAreaProvider renders its children.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
