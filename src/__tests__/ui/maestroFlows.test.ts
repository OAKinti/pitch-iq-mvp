import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const MAESTRO = path.join(ROOT, '.maestro');
const SRC = path.join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__') walk(p, out);
    } else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

const literals = new Set<string>();
const prefixes = new Set<string>();
for (const f of walk(SRC)) {
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/testID=(?:"([^"]+)"|'([^']+)'|\{'([^']+)'\})/g)) {
    literals.add((m[1] ?? m[2] ?? m[3]) as string);
  }
  for (const m of text.matchAll(/testID=\{`([^`]*)`\}/g)) {
    const t = m[1] as string;
    const i = t.indexOf('${');
    if (i === -1) literals.add(t);
    else prefixes.add(t.slice(0, i));
  }
  // object fields and default parameter values
  for (const m of text.matchAll(/testID\??:\s*['"]([^'"]+)['"]/g)) literals.add(m[1] as string);
  for (const m of text.matchAll(/testID\s*=\s*'([^']+)'/g)) literals.add(m[1] as string);
}

const flows = fs.readdirSync(MAESTRO).filter((f) => f.endsWith('.yaml'));
const idsOf = (name: string): string[] =>
  [
    ...fs.readFileSync(path.join(MAESTRO, name), 'utf8').matchAll(/^\s*(?:-\s*)?id:\s*(\S+)\s*$/gm),
  ].map((m) => m[1] as string);

describe('Maestro flows are statically sound (UI-1)', () => {
  it('finds the expected flows and a non-trivial testID set', () => {
    for (const f of [
      'mvp-smoke.yaml',
      'pose-telemetry.yaml',
      'sticker-share.yaml',
      'under13-share-locked.yaml',
    ])
      expect(flows).toContain(f);
    expect(literals.size).toBeGreaterThan(30);
    expect(prefixes.has('share-')).toBe(true);
  });

  it.each(flows)('%s uses the app id and only resolvable testIDs', (name) => {
    const text = fs.readFileSync(path.join(MAESTRO, name), 'utf8');
    expect(text).toMatch(/^appId: com\.pitchiq\.mvp$/m);
    expect(text).not.toMatch(/^[ \t]*-[ \t]*(tapOn|assertVisible):[ \t]*["'\w]/m);
    const ids = idsOf(name);
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) {
      const ok = literals.has(id) || [...prefixes].some((p) => id.startsWith(p));
      expect({ name, id, ok }).toEqual({ name, id, ok: true });
    }
  });

  const requires: Record<string, { assert: string[]; tap?: string[] }> = {
    'pose-telemetry.yaml': { assert: ['skeleton-overlay', 'telemetry-fps', 'pose-source'] },
    'sticker-share.yaml': {
      assert: ['ovr-sticker', 'share-summary'],
      tap: ['share-instagram_stories'],
    },
    'under13-share-locked.yaml': { assert: ['share-age-locked'] },
  };
  it.each(Object.entries(requires))('%s covers its required ids', (name, req) => {
    const text = fs.readFileSync(path.join(MAESTRO, name), 'utf8');
    for (const id of req.assert)
      expect(text).toMatch(new RegExp(`assertVisible:\\s*\\n\\s*id: ${id}\\b`));
    for (const id of req.tap ?? [])
      expect(text).toMatch(new RegExp(`tapOn:\\s*\\n\\s*id: ${id}\\b`));
  });
});
