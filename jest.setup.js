/* global jest */
// Reanimated 4: package.json "resolver" routes worklets to their JS implementation;
// the mock makes animations resolve synchronously.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
// Safe-area: provide fixed insets/frame so SafeAreaProvider renders its children.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
// Skia (D2.0): Canvas/Group/Circle/Line render as host Views labelled `skia-<Name>` so overlay
// tests can count joints/bones without a native canvas.
jest.mock('@shopify/react-native-skia', () => {
  const React = require('react');
  const { View } = require('react-native');
  const host = (name) => {
    const C = ({ children, ...props }) =>
      React.createElement(View, { ...props, accessibilityLabel: `skia-${name}` }, children);
    C.displayName = `Skia${name}`;
    return C;
  };
  return {
    Canvas: host('Canvas'),
    Group: host('Group'),
    Circle: host('Circle'),
    Line: host('Line'),
    vec: (x = 0, y = 0) => ({ x, y }),
  };
});
// expo-audio (D2.0): players are plain jest.fn objects; tests assert calls, never play sound.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
    replace: jest.fn(),
    remove: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    volume: 1,
    playing: false,
  })),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));
// expo-mediapipe-pose (D2.0): native module absent in jest; src/services/cv binds it lazily.
jest.mock('expo-mediapipe-pose', () => ({}));
