import { createFpsMeter } from '../../../services/cv/fpsMeter';

describe('createFpsMeter', () => {
  it('reports 30 +/- 1 for 30 FPS timestamps after the first window', () => {
    const m = createFpsMeter();
    let v = 0;
    for (let i = 0; i < 90; i += 1) v = m.push((i * 1000) / 30);
    expect(v).toBeGreaterThanOrEqual(29);
    expect(v).toBeLessThanOrEqual(31);
    expect(m.current()).toBe(v);
  });

  it('tracks a rate change', () => {
    const m = createFpsMeter();
    let t = 0;
    for (let i = 0; i < 60; i += 1) {
      t += 1000 / 30;
      m.push(t);
    }
    let v = 0;
    for (let i = 0; i < 60; i += 1) {
      t += 1000 / 15;
      v = m.push(t);
    }
    expect(Math.abs(v - 15)).toBeLessThanOrEqual(1);
  });

  it('ignores non-increasing and non-finite timestamps', () => {
    const m = createFpsMeter();
    m.push(100);
    const v = m.push(200);
    expect(m.push(200)).toBe(v);
    expect(m.push(150)).toBe(v);
    expect(m.push(Number.NaN)).toBe(v);
    expect(m.push(Infinity)).toBe(v);
  });

  it('is 0 after reset and accepts earlier timestamps again', () => {
    const m = createFpsMeter();
    for (let i = 0; i < 40; i += 1) m.push(i * 33);
    m.reset();
    expect(m.current()).toBe(0);
    expect(m.push(5)).toBeGreaterThan(0);
  });

  it('scales a custom window to per-second and falls back on a bad window', () => {
    const m = createFpsMeter(500);
    let v = 0;
    for (let i = 0; i < 60; i += 1) v = m.push((i * 1000) / 30);
    expect(Math.abs(v - 30)).toBeLessThanOrEqual(2);
    const bad = createFpsMeter(-1);
    let w = 0;
    for (let i = 0; i < 60; i += 1) w = bad.push((i * 1000) / 30);
    expect(Math.abs(w - 30)).toBeLessThanOrEqual(1);
  });
});
