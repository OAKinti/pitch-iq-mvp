import { planCueClips, renderCueSourcesModule } from '../../../services/audio/cueClips';
import { CUE_TEXT } from '../../../services/voice/cueLibrary';

describe('cueClips', () => {
  const plan = planCueClips();
  it('plans 39 unique file names', () => {
    expect(plan).toHaveLength(39);
    expect(new Set(plan.map((p) => p.fileName)).size).toBe(39);
    expect(plan[0]?.fileName).toBe('captain__calibrate_step_back.mp3');
  });
  it('takes text from CUE_TEXT', () => {
    for (const p of plan) expect(p.text).toBe(CUE_TEXT[p.persona][p.id]);
  });
  it('renders a module with 39 require lines and no env-derived content', () => {
    process.env.ELEVENLABS_API_KEY = 'sk-secret-test';
    const src = renderCueSourcesModule(plan);
    delete process.env.ELEVENLABS_API_KEY;
    expect(src.split('\n').filter((l) => l.includes('require(')).length).toBe(39);
    expect(src).not.toMatch(/process\.env|sk-secret|http/);
    expect(src).toContain("require('../../../assets/audio/cues/hype__drill_complete.mp3')");
  });
});
