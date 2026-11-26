// Local Expo config plugin: memory-safe Gradle settings for EAS cloud builds (Nov 25 2026).
// The first dev build died with "Gradle build daemon disappeared unexpectedly" (the worker ran out of
// memory while the Gradle daemon, the Kotlin daemon and parallel native compiles ran together).
// Trade a little build time for a bounded memory footprint. Applied at prebuild (CNG), so there is no
// committed android/ folder to keep in sync.
const { withGradleProperties } = require('expo/config-plugins');

const PROPS = {
  'org.gradle.jvmargs':
    '-Xmx4g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
  'kotlin.daemon.jvmargs': '-Xmx2g',
  'org.gradle.parallel': 'false',
  'org.gradle.workers.max': '2',
};

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      const i = cfg.modResults.findIndex((p) => p.type === 'property' && p.key === key);
      const item = { type: 'property', key, value };
      if (i >= 0) cfg.modResults[i] = item;
      else cfg.modResults.push(item);
    }
    return cfg;
  });
};
