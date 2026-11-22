/* global jest */
// Reanimated 4 ships a JS mock for Jest; worklets run synchronously.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
