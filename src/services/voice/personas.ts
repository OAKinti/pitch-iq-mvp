import type { CoachPersona } from '../../types/contracts';

export const PERSONAS: Readonly<
  Record<CoachPersona, { label: string; tagline: string; elevenLabsVoiceEnv: string }>
> = {
  captain: {
    label: 'The Captain',
    tagline: 'Calm leader. Steady, clear, always one step ahead.',
    elevenLabsVoiceEnv: 'ELEVENLABS_VOICE_CAPTAIN',
  },
  drill_sergeant: {
    label: 'Drill Sergeant',
    tagline: 'Intense and demanding. No excuses, only reps.',
    elevenLabsVoiceEnv: 'ELEVENLABS_VOICE_DRILL_SERGEANT',
  },
  hype: {
    label: 'Hype Coach',
    tagline: 'Pure energy. Every touch is a highlight.',
    elevenLabsVoiceEnv: 'ELEVENLABS_VOICE_HYPE',
  },
};
