// REL-5 (amended Nov 25): the local config plugin writes bounded, non-parallel Gradle settings.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withGradleMemory = require('../../../plugins/withGradleMemory') as (c: unknown) => unknown;

type Prop = { type: 'property' | 'comment' | 'empty'; key?: string; value?: string };

jest.mock('expo/config-plugins', () => ({
  // Run the mod immediately on a fake gradle.properties so the test sees what prebuild would write.
  withGradleProperties: (config: { modResults: Prop[] }, mod: (c: { modResults: Prop[] }) => unknown) => mod(config),
}));

const run = (modResults: Prop[]): Prop[] =>
  (withGradleMemory({ modResults }) as { modResults: Prop[] }).modResults;
const get = (props: Prop[], key: string) => props.filter((p) => p.type === 'property' && p.key === key);

describe('withGradleMemory', () => {
  it('replaces the Expo default jvmargs and adds the bounded settings exactly once', () => {
    const out = run([
      { type: 'comment', value: 'Expo defaults' },
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m -XX:MaxMetaspaceSize=512m' },
      { type: 'property', key: 'org.gradle.parallel', value: 'true' },
      { type: 'property', key: 'newArchEnabled', value: 'true' },
    ]);
    expect(get(out, 'org.gradle.jvmargs')).toEqual([
      expect.objectContaining({ value: expect.stringMatching(/-Xmx4g .*MaxMetaspaceSize=1g/) }),
    ]);
    expect(get(out, 'org.gradle.parallel')[0]?.value).toBe('false');
    expect(get(out, 'org.gradle.workers.max')[0]?.value).toBe('2');
    expect(get(out, 'kotlin.daemon.jvmargs')[0]?.value).toBe('-Xmx2g');
    expect(get(out, 'newArchEnabled')[0]?.value).toBe('true'); // unrelated properties untouched
    expect(out.filter((p) => p.type === 'comment')).toHaveLength(1);
  });

  it('is idempotent (running prebuild twice does not duplicate keys)', () => {
    const once = run([]);
    const twice = run(once.map((p) => ({ ...p })));
    for (const key of ['org.gradle.jvmargs', 'kotlin.daemon.jvmargs', 'org.gradle.parallel', 'org.gradle.workers.max']) {
      expect(get(twice, key)).toHaveLength(1);
    }
  });
});
