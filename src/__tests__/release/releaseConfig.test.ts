import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...p: string[]): string => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const appRaw = read('app.json');
const easRaw = read('eas.json');
const checklist = read('docs', 'RELEASE_CHECKLIST.md');
const expo: Json = (JSON.parse(appRaw) as Json).expo;
const eas: Json = JSON.parse(easRaw);
const flows = fs.readdirSync(path.join(ROOT, '.maestro')).filter((f) => f.endsWith('.yaml'));

const plugin = (name: string): Json | string | undefined => {
  const hit = (expo.plugins as unknown[]).find((p) => (Array.isArray(p) ? p[0] : p) === name);
  return Array.isArray(hit) ? (hit[1] as Json | string) : (hit as string | undefined);
};
const opts = (name: string): Json => plugin(name) as Json;

describe('release config', () => {
  it('bundle id, package and Maestro appId agree', () => {
    expect(expo.ios.bundleIdentifier).toBe(expo.android.package);
    expect(expo.ios.bundleIdentifier).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/);
    expect(flows.length).toBeGreaterThan(0);
    for (const f of flows) {
      const m = /^appId:\s*(\S+)/m.exec(read('.maestro', f));
      expect(m?.[1]).toBe(expo.ios.bundleIdentifier);
    }
  });

  it('version, buildNumber and versionCode are well-formed', () => {
    expect(expo.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof expo.ios.buildNumber).toBe('string');
    expect(expo.ios.buildNumber).toMatch(/^[1-9]\d*$/);
    expect(Number.isInteger(expo.android.versionCode)).toBe(true);
    expect(expo.android.versionCode).toBeGreaterThanOrEqual(1);
    for (const k of ['name', 'slug', 'scheme', 'icon']) expect(expo[k]).toBeTruthy();
    expect(fs.existsSync(path.join(ROOT, expo.icon))).toBe(true);
  });

  it('eas production profile is a store build with autoIncrement', () => {
    const p = eas.build.production;
    expect(p.distribution).toBe('store');
    expect(p.autoIncrement).toBe(true);
    expect(p.android.buildType).toBe('app-bundle');
    expect(p.developmentClient).toBeUndefined();
  });

  it('development profile and appVersionSource are unchanged', () => {
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.development).toEqual({
      developmentClient: true,
      distribution: 'internal',
      android: { buildType: 'apk' },
    });
  });

  it('iOS usage strings are present, consistent and specific', () => {
    const plist = expo.ios.infoPlist as Json;
    for (const k of [
      'NSCameraUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSPhotoLibraryAddUsageDescription',
    ]) {
      expect(typeof plist[k]).toBe('string');
      expect(plist[k].startsWith('PitchIQ')).toBe(true);
      expect(plist[k].length).toBeGreaterThanOrEqual(40);
    }
    const cam = plist.NSCameraUsageDescription as string;
    expect(opts('expo-camera').cameraPermission).toBe(cam);
    expect(plugin('expo-mediapipe-pose')).toBe(cam);
    expect(cam).toMatch(/skeletal/i);
    expect(cam).toMatch(/consent/i);
    const mic = plist.NSMicrophoneUsageDescription as string;
    expect(opts('expo-camera').microphonePermission).toBe(mic);
    expect(opts('expo-audio').microphonePermission).toBe(mic);
    expect(plist.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it('no forbidden Info.plist keys', () => {
    const keys = Object.keys(expo.ios.infoPlist as Json);
    const forbidden = /faceid|location|tracking|speechrecognition|contacts|UIBackgroundModes/i;
    expect(keys.filter((k) => forbidden.test(k))).toEqual([]);
  });

  it('Android permissions are minimal and media, storage and location are blocked', () => {
    expect(expo.android.permissions).toEqual(['android.permission.CAMERA']);
    const blocked = expo.android.blockedPermissions as string[];
    const required = [
      'READ_MEDIA_VIDEO',
      'READ_MEDIA_IMAGES',
      'READ_MEDIA_AUDIO',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
      'ACCESS_MEDIA_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
    ].map((n) => `android.permission.${n}`);
    expect([...blocked].sort()).toEqual([...required].sort());
    expect(blocked).not.toContain('android.permission.CAMERA');
    expect(blocked).not.toContain('android.permission.RECORD_AUDIO');
  });

  it('release checklist has every required section and command', () => {
    const headings = checklist
      .split('\n')
      .filter((l) => l.startsWith('## '))
      .map((l) => l.slice(3).trim());
    expect(headings).toEqual([
      'Prerequisites',
      'Version bump',
      'Secrets and environment',
      'iOS - TestFlight internal',
      'Android - Play Internal App Sharing',
      'Privacy and store declarations',
      'Smoke test',
      'Rollback',
    ]);
    for (const c of [
      'npm run verify',
      'npx expo-doctor',
      'eas build --profile production --platform ios',
      'eas build --profile production --platform android',
      'eas submit --platform ios --latest',
      'eas build:version:set',
      'Internal App Sharing',
    ]) {
      expect(checklist).toContain(c);
    }
    expect(checklist).toMatch(/appVersionSource.*remote/);
    for (const t of ['[human:A]', '[human:B]', '[device]', '[secret:EXPO_TOKEN]']) {
      expect(checklist).toContain(t);
    }
    expect(checklist).not.toMatch(/\bTBD\b|\bTODO\b/);
  });

  it('D2.0 plugin list and options are intact', () => {
    const names = (expo.plugins as unknown[]).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toEqual([
      'expo-dev-client',
      'expo-build-properties',
      'expo-audio',
      'expo-camera',
      'expo-media-library',
      'expo-mediapipe-pose',
      'react-native-share',
      'expo-asset',
    ]);
    expect(opts('expo-build-properties').android.minSdkVersion).toBe(26);
    const audio = opts('expo-audio');
    expect(audio.recordAudioAndroid).toBe(false);
    expect(audio.enableBackgroundRecording).toBe(false);
    expect(audio.enableBackgroundPlayback).toBe(false);
    const lib = opts('expo-media-library');
    expect(lib.granularPermissions).toEqual([]);
    expect(lib.isAccessMediaLocationEnabled).toBe(false);
    expect(opts('expo-camera').barcodeScannerEnabled).toBe(false);
  });

  it('app.json, eas.json and the checklist contain no secret and only allowlisted EXPO_PUBLIC names', () => {
    const secretRes = [/sk-ant-/, /service_role/, /xi-api-key/, /eyJ[A-Za-z0-9_-]{10,}/];
    const allowed = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'DEMO_MODE',
      'FACEBOOK_APP_ID',
      'TIKTOK_CLIENT_KEY',
    ].map((n) => `EXPO_PUBLIC_${n}`);
    for (const text of [appRaw, easRaw, checklist]) {
      for (const re of secretRes) expect(text).not.toMatch(re);
      for (const n of text.match(/EXPO_PUBLIC_[A-Z0-9_]+/g) ?? []) expect(allowed).toContain(n);
    }
    expect(Object.keys((expo.extra ?? {}) as Json).filter((k) => k !== 'eas')).toEqual([]);
  });
});
