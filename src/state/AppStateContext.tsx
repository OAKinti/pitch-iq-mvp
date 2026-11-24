import { AppState as RNAppState } from 'react-native';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  DEMO_USER_ID,
  createEdgeFunctionTransport,
  createCuePlayer,
  createRepository,
  CUE_AUDIO_SOURCES,
  createVoiceCoach,
  getAppConfig,
  getSupabaseClient,
  type AppConfig,
  type CuePlayer,
  type PitchIqRepository,
  type VoiceCoach,
} from '../services';

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
  initial,
}: AppStateProviderProps) {
  const config = useMemo(() => configOverride ?? getAppConfig(), [configOverride]);
  const repository = useMemo(() => repositoryOverride ?? createRepository(config), [repositoryOverride, config]);
  const now = useMemo(() => nowOverride ?? (() => new Date()), [nowOverride]);

  const [ageBracket, setAgeBracket] = useState<AgeBracket | null>(initial?.ageBracket ?? null);
  const [persona, setPersonaState] = useState<CoachPersona>(initial?.persona ?? 'captain');
  const [position, setPositionState] = useState<PlayerPosition>(initial?.position ?? 'MID');
  const [consents, setConsents] = useState<ConsentRecord[]>(initial?.consents ?? []);
  const [results, setResults] = useState<DrillResult[]>([]);
  const [ovr, setOvr] = useState<OvrResult | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [archetypes, setArchetypes] = useState<ArchetypeMatch[]>([]);
  const [debrief, setDebrief] = useState<Debrief | null>(null);

  const voiceCoach = useMemo(() => {
    if (voiceCoachOverride) return voiceCoachOverride;
    const client = getSupabaseClient(config);
    return createVoiceCoach({ persona, transport: client ? createEdgeFunctionTransport(client) : null });
  }, [voiceCoachOverride, persona, config]);

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
        cuePlayer.reassertAudioMode().catch(() => undefined);
      } else {
        cuePlayer.stopAll();
        setBackgroundTick((n) => n + 1);
      }
    });
    return () => sub?.remove();
  }, [cuePlayer]);

  const live = useRef({ results, position, voiceCoach, persona });
  live.current = { results, position, voiceCoach, persona };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setAge = useCallback((bracket: AgeBracket) => setAgeBracket(bracket), []);
  const setPersona = useCallback((p: CoachPersona) => setPersonaState(p), []);
  const setPosition = useCallback((p: PlayerPosition) => setPositionState(p), []);

  const grantConsent = useCallback(
    (type: ConsentType) => {
      const record: ConsentRecord = {
        type,
        policyVersion: CONSENT_POLICY_VERSION,
        grantedAt: now().toISOString(),
      };
      setConsents((prev) => [...prev.filter((c) => c.type !== type), record]);
      repository.recordConsent(DEMO_USER_ID, record).catch(() => undefined);
    },
    [repository, now],
  );

  const completeDrill = useCallback(
    (result: DrillResult) => {
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
      repository.saveDrillResult(DEMO_USER_ID, result, nextOvr).catch(() => undefined);
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
          if (mounted.current) setDebrief(d);
        })
        .catch(() => undefined);
    },
    [repository],
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
      hasConsent: (type) => consents.some((c) => c.type === type),
      setAge,
      grantConsent,
      setPersona,
      setPosition,
      completeDrill,
    }),
    [ageBracket, persona, position, consents, results, ovr, badges, archetypes, debrief, config, repository, voiceCoach, cuePlayer, backgroundTick, now, setAge, grantConsent, setPersona, setPosition, completeDrill],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
