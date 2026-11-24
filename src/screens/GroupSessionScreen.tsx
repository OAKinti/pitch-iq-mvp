import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HudPanel, NavBackButton, ScreenFrame, SectionLabel } from '../components';
import { useAppState } from '../state/AppStateContext';
import { computeCrowns, computeRivalry } from '../domain';
import { DEMO_GROUP_ID, DEMO_USER_ID } from '../services';
import type { GroupMemberStat } from '../types/contracts';
import { borders, colors, radii, sizes, spacing, typography } from '../theme/tokens';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;

/** Distinct active days in the trailing 90 days (same window as computeCrowns). */
function activeDaysInWindow(member: GroupMemberStat, now: Date): number {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
  const days = new Set<number>();
  for (const d of member.activeDays) {
    const n = Date.parse(`${d}T00:00:00Z`) / DAY_MS;
    if (n > today - WINDOW_DAYS && n <= today) days.add(n);
  }
  return days.size;
}

export function GroupSessionScreen() {
  const { repository, now } = useAppState();
  const [members, setMembers] = useState<GroupMemberStat[]>([]);
  const snapshotSeen = useRef(false);

  useEffect(() => {
    let active = true;
    snapshotSeen.current = false;
    repository
      .listGroupMembers(DEMO_GROUP_ID)
      .then((m) => {
        if (active && !snapshotSeen.current) setMembers(m);
      })
      .catch(() => undefined);
    const unsubscribe = repository.subscribeToGroup(DEMO_GROUP_ID, (m) => {
      snapshotSeen.current = true;
      if (active) setMembers(m);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [repository]);

  const ranked = useMemo(() => [...members].sort((a, b) => b.bestOvr - a.bestOvr), [members]);
  const clock = now();
  const crowns = useMemo(() => computeCrowns(members, clock), [members, clock]);
  const performer = members.find((m) => m.userId === crowns.performance);
  const consistent = members.find((m) => m.userId === crowns.consistency);

  const myIndex = ranked.findIndex((m) => m.userId === DEMO_USER_ID);
  const me = ranked[myIndex];
  const rival = myIndex > 0 ? ranked[myIndex - 1] : ranked[myIndex + 1];
  const rivalry = me && rival ? computeRivalry(me, rival) : null;

  return (
    <ScreenFrame testID="screen-group" kicker="Group session" title="Sunday league">
      <NavBackButton />
      <View style={styles.crowns}>
        <View style={styles.flex}>
          <HudPanel testID="crown-performance" title="Performance crown" accent>
            <Text style={styles.crownName}>{performer ? performer.displayName : '—'}</Text>
            <Text style={styles.crownStat}>{performer ? `${performer.bestOvr.toFixed(1)} OVR` : ''}</Text>
          </HudPanel>
        </View>
        <View style={styles.flex}>
          <HudPanel testID="crown-consistency" title="Consistency crown">
            <Text style={styles.crownName}>{consistent ? consistent.displayName : '—'}</Text>
            <Text style={styles.crownStat}>
              {consistent ? `${activeDaysInWindow(consistent, clock)} active days / 90` : ''}
            </Text>
          </HudPanel>
        </View>
      </View>

      <HudPanel testID="rivalry-objective" title="Rivalry objective" accent>
        {rivalry ? (
          <>
            <Text style={styles.rivalry}>{rivalry.description}</Text>
            <View style={styles.track}>
              <View testID="rivalry-progress" style={[styles.fill, { width: `${rivalry.progress * 100}%` }]} />
            </View>
            <SectionLabel text={`${Math.round(rivalry.progress * 100)}% there`} tone="telemetry" />
          </>
        ) : (
          <Text style={styles.crownStat}>Waiting for group data…</Text>
        )}
      </HudPanel>

      <HudPanel title="Leaderboard">
        {ranked.map((m, i) => (
          <View
            key={m.userId}
            testID={`leaderboard-row-${m.userId}`}
            style={[styles.row, m.userId === DEMO_USER_ID && styles.rowMe]}
          >
            <Text style={[styles.rank, m.userId === DEMO_USER_ID && styles.rankMe]}>{i + 1}</Text>
            <Text style={styles.name}>{m.displayName}</Text>
            <Text style={styles.score}>{m.bestOvr.toFixed(1)}</Text>
          </View>
        ))}
      </HudPanel>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  crowns: { flexDirection: 'row', gap: spacing.md },
  crownName: { color: colors.textPrimary, fontSize: typography.size.title, fontWeight: typography.weight.black },
  crownStat: {
    color: colors.crownGold,
    fontFamily: typography.family.mono,
    fontSize: typography.size.caption,
    ...typography.tabular,
  },
  rivalry: { color: colors.textPrimary, fontSize: typography.size.bodyLg },
  track: {
    height: sizes.progressHeight,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceHigh,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent },
  row: {
    minHeight: sizes.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.border,
  },
  rowMe: { backgroundColor: colors.accentDim },
  rank: {
    width: sizes.iconMd,
    color: colors.textMuted,
    fontFamily: typography.family.mono,
    fontSize: typography.size.bodyLg,
    ...typography.tabular,
  },
  rankMe: { color: colors.textSecondary },
  name: { flex: 1, color: colors.textPrimary, fontSize: typography.size.bodyLg },
  score: {
    color: colors.accent,
    fontFamily: typography.family.mono,
    fontSize: typography.size.title,
    fontWeight: typography.weight.bold,
    ...typography.tabular,
  },
});
