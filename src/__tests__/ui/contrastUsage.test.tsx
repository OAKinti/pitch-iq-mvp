import { StyleSheet } from 'react-native';
import { screen, waitFor } from '@testing-library/react-native';
import { DEMO_USER_ID } from '../../services';
import { colors } from '../../theme/tokens';
import { renderNavigator } from './helpers';

const ALLOWED_ON_ACCENT_DIM: readonly string[] = [colors.textPrimary, colors.textSecondary, colors.accent];

function collectTexts(node: unknown, out: { style: unknown }[]): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { type?: unknown; props?: { style?: unknown }; children?: unknown[] };
  if (n.type === 'Text') out.push({ style: n.props?.style });
  (n.children ?? []).forEach((c) => collectTexts(c, out));
}

describe('own leaderboard row colors (A11Y-3)', () => {
  it('uses only colors approved on accentDim', async () => {
    await renderNavigator({ initialRoute: 'GroupSession' });
    await waitFor(() => expect(screen.getByTestId(`leaderboard-row-${DEMO_USER_ID}`)).toBeTruthy());
    const row = screen.getByTestId(`leaderboard-row-${DEMO_USER_ID}`);
    const texts: { style: unknown }[] = [];
    collectTexts(screen.toJSON() && JSON.parse(JSON.stringify(findNode(screen.toJSON(), row.props.testID))), texts);
    expect(texts.length).toBeGreaterThanOrEqual(3);
    for (const t of texts) {
      const color = StyleSheet.flatten(t.style as never)?.color as string;
      expect(ALLOWED_ON_ACCENT_DIM).toContain(color);
    }
  });
});

function findNode(tree: unknown, testID: string): unknown {
  const list = Array.isArray(tree) ? tree : [tree];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const n = item as { props?: { testID?: string }; children?: unknown[] };
    if (n.props?.testID === testID) return n;
    const hit = findNode(n.children ?? [], testID);
    if (hit) return hit;
  }
  return null;
}
