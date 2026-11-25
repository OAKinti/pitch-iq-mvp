import { AppState as RNAppState } from 'react-native';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CONSENT_POLICY_VERSION,
  type AgeBracket,
  type ArchetypeMatch,
  type Badge,
  type CoachPersona,
  type ConsentRecord,
  type ConsentType,
  type Debrief,
  type DrillResult,
  type OvrResult,
  type PlayerPosition,
  type ProfileVisibility,
} from '../types/contracts';
import {
  defaultVisibility,
  deriveAttributes,
  computeOvr,
  evaluateBadges,
  matchArchetypes,
  requiresParentalConsent,
} from '../domain';
import {
  createAuthService,
  createEdgeFunctionTransport,
  createCuePlayer,
  createRepository,
  CUE_AUDIO_SOURCES,
  createVoiceCoach,
  getAppConfig,
  getSupabaseClient,
  type AppConfig,
  type AuthService,
  type CuePlayer,
  type PitchIqRepository,
  type SyncStatus,
  type VoiceCoach,
} from '../services';
import { createLocalProfileStore, type LocalProfileStore } from '../services/persist/localProfile';
import { DEMO_GROUP_ID } from '../services/supabase/repository';
import { joinNoticeText, type JoinNoticeReason } from '../services/invites/inviteLink';

const DEFAULT_DISPLAY_NAME = 'Player';

/** Result of the last squad-join attempt; `seq` changes on every attempt so the UI can react once. */
export interface JoinNotice {
  seq: number;
  ok: boolean;
  reason: JoinNoticeReason;
  text: string;
}

export interface AppState {
  ageBracket: AgeBracket | null;
  visibility: ProfileVisibility;
  requiresParent: boolean;
  persona: CoachPersona;
  position: PlayerPosition;
  consents: ConsentRecord[];
  results: DrillResult[];
  ovr: OvrResult | null;
  badges: Badge[];
  archetypes: ArchetypeMatch[];
  debrief: Debrief | null;
  config: AppConfig;
  repository: PitchIqRepository;
  voiceCoach: VoiceCoach;
  /** The single Tier 1 cue player (ECON-1). */
  cuePlayer: CuePlayer;
  /** Increments each time the app leaves the foreground (REC-2). */
  backgroundTick: number;
  now: () => Date;
  /** Result of the last server write: 'offline' (no session yet), 'error' (write rejected) or 'ok'. */
  syncStatus: SyncStatus;
  /** Auth user id once a session exists (Demo Mode: DEMO_USER_ID); null while offline. */
  userId: string | null;
  /** True once the persisted local profile has been read. */
  hydrated: boolean;
  /** True when the age bracket was persisted by an earlier run: the age gate cannot be retried. */
  ageLocked: boolean;
  /** Invite code received before onboarding finished; joined automatically afterwards. */
  pendingInvite: string | null;
  joinNotice: JoinNotice | null;
  /** The squad shown on the Group screen (the demo squad until an invite joins another). */
  groupId: string;
  /** Accepts a validated invite code: joins now, or after onboarding + session. */
  joinFromInvite: (code: string) => void;
  hasConsent: (type: ConsentType) => boolean;
  setAge: (bracket: AgeBracket) => void;
  grantConsent: (type: ConsentType) => void;
  setPersona: (persona: CoachPersona) => void;
  setPosition: (position: PlayerPosition) => void;
  completeDrill: (result: DrillResult) => void;
}

const AppStateContext = createContext<AppState | null>(null);

export interface AppStateProviderProps {
  children: React.ReactNode;
  repository?: PitchIqRepository;
  voiceCoach?: VoiceCoach;
  cuePlayer?: CuePlayer;
  now?: () => Date;
  config?: AppConfig;
  auth?: AuthService;
  localProfile?: LocalProfileStore;
  /** Test seeding only. */
  initial?: {
    ageBracket?: AgeBracket;
    consents?: ConsentRecord[];
    persona?: CoachPersona;
    position?: PlayerPosition;
  };
}

export function AppStateProvider({
  children,
  repository: repositoryOverride,
  voiceCoach: voiceCoachOverride,
  cuePlayer: cuePlayerOverride,
  now: nowOverride,
  config: configOverride,
  auth: authOverride,
  localProfile: localProfileOverride,
  initial,
}: AppStateProviderProps) {
  const config = useMemo(() => configOverride ?? getAppConfig(), [configOverride]);
  const repository = useMemo(
    () => repositoryOverride ?? createRepository(config),
    [repositoryOverride, config],
  );
  const now = useMemo(() => nowOverride ?? (() => new Date()), [nowOverride]);
  const auth = useMemo(
    () => authOverride ?? createAuthService(getSupabaseClient(config)),
    [authOverride, config],
  );
  const localProfile = useMemo(
    () => localProfileOverride ?? createLocalProfileStore(),
    [localProfileOverride],
  );

  const [ageBracket, setAgeBracket] = useState<AgeBracket | null>(initial?.ageBracket ?? null);
  const [persona, setPersonaState] = useState<CoachPersona>(initial?.persona ?? 'captain');
  const [position, setPositionState] = useState<PlayerPosition>(initial?.position ?? 'MID');
  const [consents, setConsents] = useState<ConsentRecord[]>(initial?.consents ?? []);
  const [results, setResults] = useState<DrillResult[]>([]);
  const [ovr, setOvr] = useState<OvrResult | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [archetypes, setArchetypes] = useState<ArchetypeMatch[]>([]);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('ok');
  const [userId, setUserId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [ageLocked, setAgeLocked] = useState(false);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState<JoinNotice | null>(null);
  const [groupId, setGroupId] = useState(DEMO_GROUP_ID);
  const joinSeq = useRef(0);
  const debriefToken = useRef(0);
  const retrySession = useRef<() => void>(() => undefined);

  const voiceCoach = useMemo(() => {
    if (voiceCoachOverride) return voiceCoachOverride;
    const client = getSupabaseClient(config);
    // COPPA-1 / D-9C: an under-13 player is never sent to Tier 2 until a parent is verified. Verification
    // is server-side only (service_role), so on the client every under-13 profile is unverified.
    const tier2Allowed = !(ageBracket && requiresParentalConsent(ageBracket));
    return createVoiceCoach({
      persona,
      transport: client && tier2Allowed ? createEdgeFunctionTransport(client) : null,
    });
  }, [voiceCoachOverride, persona, config, ageBracket]);

  const cuePlayer = useMemo(
    () => cuePlayerOverride ?? createCuePlayer({ sources: CUE_AUDIO_SOURCES }),
    [cuePlayerOverride],
  );
  const [backgroundTick, setBackgroundTick] = useState(0);

  useEffect(() => {
    cuePlayer.prepare(persona).catch(() => undefined);
  }, [cuePlayer, persona]);

  useEffect(
    () => () => {
      if (!cuePlayerOverride) cuePlayer.dispose();
    },
    [cuePlayer, cuePlayerOverride],
  );

  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (status) => {
      if (status === 'active') {
        // Offline at launch: retry the anonymous session each time the app returns to the foreground.
        retrySession.current();
        cuePlayer.reassertAudioMode().catch(() => undefined);
      } else if (status === 'background') {
        // REC-2: only a real background resets the drill. iOS 'inactive' (permission prompt,
        // notification banner, control centre) must not cancel a starting live drill.
        cuePlayer.stopAll();
        setBackgroundTick((n) => n + 1);
      }
    });
    return () => sub?.remove();
  }, [cuePlayer]);

  const live = useRef({ results, position, voiceCoach, persona, consents, ageLocked });
  live.current = { results, position, voiceCoach, persona, consents, ageLocked };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ---- Server writes: wait for a session, then run serially (profile row before its consents).
  type Job = (uid: string) => Promise<void>;
  const uidRef = useRef<string | null>(null);
  const pending = useRef(new Map<string, Job>());
  const chain = useRef<Promise<void>>(Promise.resolve());

  const runJob = useCallback((job: Job) => {
    const uid = uidRef.current;
    if (!uid) return;
    chain.current = chain.current
      .then(() => job(uid))
      .then(
        () => {
          if (mounted.current) setSyncStatus('ok');
        },
        () => {
          // Never log the error: it may echo user data.
          if (mounted.current) setSyncStatus('error');
        },
      );
  }, []);

  const enqueue = useCallback(
    (key: string, job: Job) => {
      if (!uidRef.current) {
        pending.current.set(key, job); // same key (profile) keeps its slot and the latest value
        setSyncStatus('offline');
        return;
      }
      runJob(job);
    },
    [runJob],
  );

  const flush = useCallback(() => {
    const jobs = [...pending.current.values()];
    pending.current.clear();
    jobs.forEach(runJob);
  }, [runJob]);

  const acquireSession = useCallback(async () => {
    const session = await auth.ensureSession();
    if (!mounted.current) return;
    if (!session) {
      setSyncStatus('offline');
      return;
    }
    uidRef.current = session.userId;
    setUserId(session.userId);
    flush();
  }, [auth, flush]);

  useEffect(() => {
    void acquireSession();
  }, [acquireSession]);

  retrySession.current = () => {
    if (!uidRef.current) void acquireSession();
  };

  // Read the persisted local profile once at startup (test `initial` seeds win).
  useEffect(() => {
    let cancelled = false;
    localProfile
      .load()
      .then((lp) => {
        if (cancelled) return;
        if (!initial?.ageBracket && lp.ageBracket) {
          setAgeBracket(lp.ageBracket);
          setAgeLocked(true);
          live.current.ageLocked = true;
        }
        if (!initial?.consents && lp.consents.length > 0) {
          live.current.consents = lp.consents;
          setConsents(lp.consents);
          // Re-sync consents a previous offline run could not deliver (unique key makes this idempotent).
          lp.consents.forEach((c) => {
            if (c.type !== 'parental_verified') {
              enqueue(`consent:${c.type}`, (uid) => repository.recordConsent(uid, c));
            }
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
    // startup only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Profile row: created once the age is known, then kept in step with persona/position. The newest
  // profile wins per key, and an unchanged profile is not re-sent.
  const lastProfileKey = useRef<string | null>(null);
  const syncProfile = useCallback(
    (bracket: AgeBracket, pos: PlayerPosition, coach: CoachPersona) => {
      const key = [bracket, pos, coach, uidRef.current ?? ''].join('|');
      if (lastProfileKey.current === key) return;
      lastProfileKey.current = key;
      enqueue('profile', (uid) =>
        repository.saveProfile(uid, {
          displayName: DEFAULT_DISPLAY_NAME,
          ageBracket: bracket,
          position: pos,
          persona: coach,
        }),
      );
    },
    [repository, enqueue],
  );

  useEffect(() => {
    if (ageBracket) syncProfile(ageBracket, position, persona);
  }, [ageBracket, position, persona, userId, syncProfile]);

  const setAge = useCallback(
    (bracket: AgeBracket) => {
      // AUTH-4: a persisted bracket cannot be changed by retrying the gate.
      if (live.current.ageLocked) return;
      setAgeBracket(bracket);
      void localProfile.save({ ageBracket: bracket });
      // Enqueue now so the profile row always precedes consents granted in the same tick.
      syncProfile(bracket, live.current.position, live.current.persona);
    },
    [localProfile, syncProfile],
  );

  // ---- Invite join (D-9B): the link is held until onboarding is done; the join then rides the same
  // serial queue, so it runs after the profile row and a session exist.
  const onboarded =
    ageBracket !== null && consents.some((c) => c.type === 'camera_skeletal_tracking');

  const joinFromInvite = useCallback((code: string) => setPendingInvite(code), []);

  useEffect(() => {
    if (!pendingInvite || !onboarded) return;
    const code = pendingInvite;
    setPendingInvite(null);
    enqueue('invite-join', async () => {
      let notice: JoinNotice;
      const seq = ++joinSeq.current;
      try {
        const res = await repository.joinGroupByInvite(code);
        const reason: JoinNoticeReason = res.ok ? 'joined' : res.reason;
        if (res.ok && mounted.current) setGroupId(res.groupId);
        notice = { seq, ok: res.ok, reason, text: joinNoticeText(reason) };
      } catch {
        notice = { seq, ok: false, reason: 'offline', text: joinNoticeText('offline') };
      }
      if (mounted.current) setJoinNotice(notice);
    });
  }, [pendingInvite, onboarded, enqueue, repository]);

  const setPersona = useCallback((p: CoachPersona) => setPersonaState(p), []);
  const setPosition = useCallback((p: PlayerPosition) => setPositionState(p), []);

  const grantConsent = useCallback(
    (type: ConsentType) => {
      const record: ConsentRecord = {
        type,
        policyVersion: CONSENT_POLICY_VERSION,
        grantedAt: now().toISOString(),
      };
      const next = [...live.current.consents.filter((c) => c.type !== type), record];
      live.current.consents = next;
      setConsents(next);
      void localProfile.save({ consents: next, onboardedAt: record.grantedAt });
      if (type !== 'parental_verified') {
        enqueue(`consent:${type}`, (uid) => repository.recordConsent(uid, record));
      }
    },
    [repository, now, localProfile, enqueue],
  );

  const completeDrill = useCallback(
    (result: DrillResult) => {
      // RACE-2: one save per drill result id (double-tapping "view results" must not duplicate).
      if (live.current.results.some((r) => r.id === result.id)) return;
      const all = [...live.current.results, result];
      const metrics = all.map((r) => r.metrics);
      const attributes = deriveAttributes(metrics);
      const nextOvr = computeOvr(attributes, live.current.position);
      const nextBadges = evaluateBadges(metrics);
      const nextArchetypes = matchArchetypes(attributes, 3);
      live.current.results = all;
      setResults(all);
      setOvr(nextOvr);
      setBadges(nextBadges);
      setArchetypes(nextArchetypes);
      setDebrief(null);
      enqueue(`drill:${result.id}`, (uid) => repository.saveDrillResult(uid, result, nextOvr));
      const token = ++debriefToken.current;
      const topArchetype = nextArchetypes[0];
      live.current.voiceCoach
        .debrief({
          persona: live.current.persona,
          result,
          ovr: nextOvr,
          badges: nextBadges,
          ...(topArchetype ? { topArchetype } : {}),
        })
        .then((d) => {
          // RACE-1: a slower, older debrief must not overwrite the newest drill's debrief.
          if (mounted.current && token === debriefToken.current) setDebrief(d);
        })
        .catch(() => undefined);
    },
    [repository, enqueue],
  );

  const value = useMemo<AppState>(
    () => ({
      ageBracket,
      visibility: ageBracket ? defaultVisibility(ageBracket) : 'private',
      requiresParent: ageBracket ? requiresParentalConsent(ageBracket) : false,
      persona,
      position,
      consents,
      results,
      ovr,
      badges,
      archetypes,
      debrief,
      config,
      repository,
      voiceCoach,
      cuePlayer,
      backgroundTick,
      now,
      syncStatus,
      userId,
      hydrated,
      ageLocked,
      pendingInvite,
      joinNotice,
      groupId,
      joinFromInvite,
      hasConsent: (type) => consents.some((c) => c.type === type),
      setAge,
      grantConsent,
      setPersona,
      setPosition,
      completeDrill,
    }),
    [
      ageBracket,
      persona,
      position,
      consents,
      results,
      ovr,
      badges,
      archetypes,
      debrief,
      config,
      repository,
      voiceCoach,
      cuePlayer,
      backgroundTick,
      now,
      syncStatus,
      userId,
      hydrated,
      ageLocked,
      pendingInvite,
      joinNotice,
      groupId,
      joinFromInvite,
      setAge,
      grantConsent,
      setPersona,
      setPosition,
      completeDrill,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
