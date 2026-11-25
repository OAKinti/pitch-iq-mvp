import type { CachedCue, CoachPersona, CueId, Debrief } from '../../types/contracts';
import { getCachedCue } from './cueLibrary';
import { DEBRIEF_MAX_CHARS, estimateDebriefCostUsd } from './costModel';
import { buildDebriefRequest, templateDebrief, truncateAtWord, type DebriefInput } from './debriefPrompt';
import { createQaBudget, type QaBudget } from './qaBudget';
import type { DebriefTransport } from './transport';

export interface VoiceCoach {
  readonly persona: CoachPersona;
  cue(id: CueId): CachedCue;
  debrief(input: DebriefInput): Promise<Debrief>;
  readonly qa: QaBudget;
}

export function createVoiceCoach(opts: {
  persona: CoachPersona;
  transport: DebriefTransport | null;
  qaCapMinutes?: number;
}): VoiceCoach {
  const { persona, transport } = opts;
  const qa = createQaBudget({ capMinutes: opts.qaCapMinutes ?? 5 });

  const fromTemplate = (input: DebriefInput): Debrief => {
    const text = truncateAtWord(templateDebrief(input), DEBRIEF_MAX_CHARS);
    return { text, audioUri: null, source: 'template', ttsChars: text.length, estimatedCostUsd: 0 };
  };

  return {
    persona,
    qa,
    cue: (id) => getCachedCue(id, persona),
    async debrief(input) {
      const scoped: DebriefInput = { ...input, persona };
      if (!transport) return fromTemplate(scoped);
      try {
        const res = await transport.requestDebrief(buildDebriefRequest(scoped));
        const text = truncateAtWord(res.text, DEBRIEF_MAX_CHARS);
        if (text.length === 0) return fromTemplate(scoped);
        return {
          text,
          audioUri: res.audioUri,
          source: 'haiku',
          ttsChars: text.length,
          estimatedCostUsd: estimateDebriefCostUsd(text.length, res.inputTokens, res.outputTokens),
        };
      } catch {
        return fromTemplate(scoped);
      }
    },
  };
}
