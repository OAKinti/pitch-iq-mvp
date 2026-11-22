import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderNavigator } from './helpers';

const isDisabled = (id: string): boolean => Boolean(screen.getByTestId(id).props.accessibilityState?.disabled);
const probe = () => JSON.parse(String(screen.getByTestId('probe').props.children)) as Record<string, unknown>;

async function enterBirth(year: string, month: string) {
  await fireEvent.changeText(screen.getByTestId('age-year-input'), year);
  await fireEvent.changeText(screen.getByTestId('age-month-input'), month);
}

describe('OnboardingScreen', () => {
  it('starts with empty, unprefilled age inputs and a disabled continue', async () => {
    await renderNavigator();
    expect(screen.getByTestId('screen-onboarding')).toBeTruthy();
    expect(screen.getByTestId('age-year-input').props.value).toBe('');
    expect(screen.getByTestId('age-month-input').props.value).toBe('');
    expect(screen.getByTestId('age-year-input').props.placeholder).toBe('YYYY');
    expect(screen.getByTestId('age-month-input').props.placeholder).toBe('MM');
    expect(isDisabled('age-continue')).toBe(true);
  });

  it.each([
    ['future year', '2030', '5'],
    ['future month this year', '2026', '12'],
    ['month out of range', '2000', '13'],
    ['implausibly old', '1800', '4'],
  ])('keeps continue disabled for %s', async (_label, year, month) => {
    await renderNavigator();
    await enterBirth(year, month);
    expect(isDisabled('age-continue')).toBe(true);
  });

  it('never mentions an age cutoff in the age-gate copy', async () => {
    await renderNavigator();
    expect(screen.queryByText(/13/)).toBeNull();
    expect(screen.queryByText(/under|over \d|years old/i)).toBeNull();
  });

  it('adult flow: consent gate, records consent, then persona and position', async () => {
    await renderNavigator();
    await enterBirth('2000', '6');
    expect(isDisabled('age-continue')).toBe(false);
    await fireEvent.press(screen.getByTestId('age-continue'));

    expect(screen.queryByTestId('private-account-notice')).toBeNull();
    expect(isDisabled('consent-accept')).toBe(true);
    expect(screen.getByText(/only skeletal joint positions/i)).toBeTruthy();
    expect(screen.getByText(/within 90 days/i)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    expect(isDisabled('consent-accept')).toBe(false);
    await fireEvent.press(screen.getByTestId('consent-accept'));

    expect(probe().consents).toEqual(['camera_skeletal_tracking']);
    expect(probe().age).toBe('adult_18_plus');

    await fireEvent.press(screen.getByTestId('persona-option-hype'));
    await fireEvent.press(screen.getByTestId('position-option-FWD'));
    expect(probe().persona).toBe('hype');
    expect(probe().position).toBe('FWD');
    expect(screen.getByTestId('persona-option-hype').props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByTestId('onboarding-finish'));
    expect(screen.getByTestId('screen-combine')).toBeTruthy();
  });

  it('consent checkbox can be unticked, re-disabling accept', async () => {
    await renderNavigator();
    await enterBirth('2000', '6');
    await fireEvent.press(screen.getByTestId('age-continue'));
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    expect(isDisabled('consent-accept')).toBe(true);
  });

  it('under-13 flow: private account, parental pending copy, parent-addressed consent', async () => {
    await renderNavigator();
    await enterBirth('2018', '3');
    await fireEvent.press(screen.getByTestId('age-continue'));

    expect(screen.getByTestId('private-account-notice')).toHaveTextContent(
      'Private account · parental verification pending',
    );
    expect(screen.getByText(/parent or guardian: please read/i)).toBeTruthy();
    expect(screen.getByText(/camera tracking stays locked/i)).toBeTruthy();
    expect(probe().visibility).toBe('private');
    expect(probe().age).toBe('under_13');

    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-accept'));
    expect(screen.getByTestId('private-account-notice')).toBeTruthy();
    expect(probe().visibility).toBe('private');
  });

  it('teen accounts are not forced into the parental flow', async () => {
    await renderNavigator();
    await enterBirth('2011', '1');
    await fireEvent.press(screen.getByTestId('age-continue'));
    expect(screen.queryByTestId('private-account-notice')).toBeNull();
    expect(probe().age).toBe('teen_13_17');
  });
});
