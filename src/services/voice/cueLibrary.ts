import type { CachedCue, CoachPersona, CueId } from '../../types/contracts';

/** Tier 1: pre-written cue lines, zero recurring cost. */
export const CUE_TEXT: Readonly<Record<CoachPersona, Readonly<Record<CueId, string>>>> = {
  captain: {
    calibrate_step_back: 'Take a few steps back so I can see you head to toe.',
    calibrate_hold_still: 'Good. Hold still for a moment while I find your frame.',
    ready_go: 'You are set. Start when you are ready.',
    out_of_frame: 'I have lost you. Step back into the frame.',
    back_in_frame: 'There you are. Carry on.',
    rhythm_good: 'Lovely rhythm. Stay relaxed and keep it going.',
    pace_up: 'Lift the tempo a touch. You have more in you.',
    switch_feet: 'Bring the other foot into it. Stay balanced.',
    halfway: 'Halfway there. Breathe and keep your shape.',
    ten_seconds: 'Ten seconds. Finish with composure.',
    final_push: 'Final push. Show me what you have got.',
    turn_sharp: 'Sink low into the turn and drive out.',
    drill_complete: 'Well done. Catch your breath, we will review it.',
  },
  drill_sergeant: {
    calibrate_step_back: 'Back up! Get your whole body in the frame. Move!',
    calibrate_hold_still: 'Freeze! Stand still until I say so.',
    ready_go: 'Go! Go! Go! Clock is running!',
    out_of_frame: 'Out of frame! Get back in. Now!',
    back_in_frame: 'Back in position. Do not make me ask twice.',
    rhythm_good: 'Tight rhythm. Do not you dare slow down.',
    pace_up: 'Too slow! Faster feet! Faster!',
    switch_feet: 'Other foot! Use both. Weak foot, work it!',
    halfway: 'Halfway. Pain is temporary. Keep grinding!',
    ten_seconds: 'Ten seconds! Empty the tank!',
    final_push: 'Everything you have, right now! Push!',
    turn_sharp: 'Plant, cut, explode! Sharper!',
    drill_complete: 'Drill done. Earned it. Now we debrief.',
  },
  hype: {
    calibrate_step_back: 'Hey superstar, scoot back so the camera catches all of you!',
    calibrate_hold_still: 'Ooh, perfect! Hold that pose for just a sec!',
    ready_go: "Let's gooo! Show the world those feet!",
    out_of_frame: 'Whoops, you wandered off! Hop back in the shot!',
    back_in_frame: "And we're back! Let's keep the party going!",
    rhythm_good: 'That rhythm is unreal! You are cooking!',
    pace_up: 'Turn it up! Crank those feet, let us see some fire!',
    switch_feet: 'Switch it up! Other foot, show off that magic!',
    halfway: 'Halfway and looking incredible! Keep it rolling!',
    ten_seconds: 'Ten seconds left! Go out with a bang!',
    final_push: 'Final push, champion! Leave it all out there!',
    turn_sharp: 'Snap that turn! Boom! Like a pro!',
    drill_complete: 'That was awesome! Seriously, big energy! Check your card!',
  },
};

/**
 * Bundled or CDN audio assets per persona and cue. Person B fills this on Day 2-3 after
 * generating audio once with ElevenLabs. A null entry means text-only for now.
 */
export const CUE_AUDIO_MANIFEST: Record<CoachPersona, Partial<Record<CueId, string>>> = {
  captain: {},
  drill_sergeant: {},
  hype: {},
};

export function getCachedCue(id: CueId, persona: CoachPersona): CachedCue {
  return {
    id,
    persona,
    text: CUE_TEXT[persona][id],
    audioUri: CUE_AUDIO_MANIFEST[persona][id] ?? null,
  };
}
