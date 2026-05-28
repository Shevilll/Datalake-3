import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';

import {
  type ActiveChallenge,
  challengePrompt,
  computeGeometry,
  randomChallenge,
  satisfiesChallenge,
} from '@/faceauth/activeLiveness';
import { photoToMat } from '@/faceauth/capture';
import { addEnrollment, listEnrolled, purgeAll } from '@/faceauth/gallery';
import { loadSessions, type Sessions } from '@/faceauth/ort';
import { enrollFromMat, verifyFromMat } from '@/faceauth/pipeline';

type Status = 'booting' | 'ready' | 'error';

export default function HomeScreen() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  // JPEG (OpenCV can't decode HEIC); capped resolution keeps full-image ops light.
  const photoOutput = usePhotoOutput({
    containerFormat: 'jpeg',
    qualityPrioritization: 'speed',
    targetResolution: { width: 720, height: 960 },
  });

  const [status, setStatus] = useState<Status>('booting');
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  // active-challenge verify flow: idle -> awaiting (user performs the prompted gesture) -> processing
  const [challenge, setChallenge] = useState<ActiveChallenge | null>(null);
  const yawSignRef = useRef<1 | -1>(-1); // front-camera mirror: turning LEFT yields +yaw on this device, so flip
  const [enrolled, setEnrolled] = useState<string[]>([]);
  const [result, setResult] = useState<string>('');
  const [log, setLog] = useState<string[]>([]);
  const sessionsRef = useRef<Sessions | null>(null);

  const push = (line: string): void => {
    // eslint-disable-next-line no-console
    console.log('[FaceAuth]', line);
    setLog((prev) => [line, ...prev].slice(0, 8));
  };

  useEffect(() => {
    void (async () => {
      push(`liquid glass: ${isLiquidGlassAvailable() ? 'available (iOS 26+)' : 'fallback (plain View)'}`);
      if (!hasPermission) await requestPermission();
      try {
        sessionsRef.current = await loadSessions();
        setStatus('ready');
        push('models loaded — ready');
      } catch (e) {
        setStatus('error');
        push(`load failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = async (): Promise<{ path: string } | null> => {
    const photo = await photoOutput.capturePhotoToFile({ flashMode: 'off' }, {});
    push(`captured -> ${photo.filePath}`);
    return { path: photo.filePath };
  };

  const handleRegister = async (): Promise<void> => {
    const sessions = sessionsRef.current;
    if (!sessions || busy) return;
    if (name.trim().length === 0) {
      setResult('Enter a name to register');
      return;
    }
    setBusy(true);
    setResult('');
    try {
      const shot = await capture();
      if (!shot) return;
      const { mat, width, height } = await photoToMat(shot.path);
      push(`decoded mat ${width}x${height}`);
      const out = await enrollFromMat(sessions, mat, width, height);
      if (!out.ok || !out.embedding) {
        setResult(`Register failed: ${out.reason ?? 'unknown'}`);
        push(`register: ${out.reason ?? 'unknown'}`);
        return;
      }
      const count = addEnrollment(name.trim(), out.embedding);
      setEnrolled(listEnrolled());
      const sc = out.detection?.score.toFixed(2);
      setResult(`Registered "${name.trim()}" — sample #${count} (det ${sc})`);
      push(`enrolled ${name.trim()} #${count} det=${sc}`);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      push(`register error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Two-step active-challenge verify.
   *  1st tap (idle): pick a random challenge, display the prompt, wait for the user to perform.
   *  2nd tap (awaiting): capture, run pipeline, check identity match + challenge geometry.
   * Final verdict: matched AND active-challenge satisfied. Passive score is shown for info only
   * (single-MiniFASNet is unreliable on modern selfies — DECISIONS.md D8 fallback).
   */
  const handleVerify = async (): Promise<void> => {
    const sessions = sessionsRef.current;
    if (!sessions || busy) return;

    if (challenge === null) {
      const c = randomChallenge();
      setChallenge(c);
      setResult('');
      push(`challenge: ${challengePrompt(c)}`);
      return;
    }

    setBusy(true);
    try {
      const shot = await capture();
      if (!shot) return;
      const { mat, width, height } = await photoToMat(shot.path);
      const out = await verifyFromMat(sessions, mat, width, height);
      if (!out.ok || !out.detection) {
        setResult(`❌ No face detected (${out.latencyMs}ms)`);
        push(`verify: no face (${out.latencyMs}ms)`);
        return;
      }
      const g = computeGeometry(out.detection.landmarks);
      const satisfied = satisfiesChallenge(challenge, g, yawSignRef.current);
      const verified = out.matched && satisfied;
      const cos = out.confidence.toFixed(3);
      const yaw = g.yaw.toFixed(2);
      const smile = g.smile.toFixed(2);
      const live = out.passiveScore.toFixed(2);
      push(`verify matched=${out.matched} sat=${satisfied} verified=${verified} cos=${cos} yaw=${yaw} smile=${smile} live=${live} (${out.latencyMs}ms)`);
      if (verified) {
        setResult(`✅ ${out.personId} — verified (${challengePrompt(challenge)} ✓, cos ${cos}, ${out.latencyMs}ms)`);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (out.matched && !satisfied) {
        setResult(`❌ Challenge failed — ${challengePrompt(challenge)} (yaw ${yaw}, smile ${smile}, ${out.latencyMs}ms)`);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        setResult(`❌ No match (best cos ${cos}, ${out.latencyMs}ms)`);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      push(`verify error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setChallenge(null);
    }
  };

  const handlePurge = (): void => {
    const n = purgeAll();
    setEnrolled(listEnrolled());
    setResult(`Purged ${n} enrolled identities`);
    push(`purged ${n}`);
  };

  return (
    <View style={styles.container}>
      {device != null && hasPermission ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          outputs={[photoOutput]}
          isActive
          onStarted={() => setCameraReady(true)}
          onStopped={() => setCameraReady(false)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCam]}>
          <Text style={styles.noCamText}>
            {hasPermission ? 'No front camera' : 'Camera permission needed'}
          </Text>
        </View>
      )}

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <GlassView style={styles.topPill} glassEffectStyle="regular" colorScheme="light">
          <Text style={styles.topPillText}>
            {status === 'error'
              ? 'Load error'
              : status !== 'ready'
                ? 'Loading models…'
                : cameraReady
                  ? 'FaceAuth ready'
                  : 'Starting camera…'}
            {enrolled.length > 0 ? `  ·  ${enrolled.length} enrolled` : ''}
          </Text>
        </GlassView>

        {challenge !== null && (
          <GlassView style={styles.challengeBanner} glassEffectStyle="regular" colorScheme="light">
            <Text style={styles.challengeBannerLabel}>ACTIVE LIVENESS</Text>
            <Text style={styles.challengeBannerPrompt}>{challengePrompt(challenge)}</Text>
            <Text style={styles.challengeBannerHint}>…then tap Capture</Text>
          </GlassView>
        )}

        <GlassView style={styles.panel} glassEffectStyle="regular" colorScheme="light">
          {result.length > 0 && <Text style={styles.result}>{result}</Text>}

          <View style={styles.logBox}>
            {log.map((l, i) => (
              <Text key={i} style={styles.logLine} numberOfLines={1}>
                {l}
              </Text>
            ))}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Name to register"
            placeholderTextColor="#7C8AA0"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          <View style={styles.row}>
            <Pressable
              style={[styles.btn, styles.register, busy && styles.btnDisabled]}
              onPress={() => void handleRegister()}
              disabled={busy || status !== 'ready' || !cameraReady}
            >
              <Text style={styles.btnText}>Register</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.verify, busy && styles.btnDisabled]}
              onPress={() => void handleVerify()}
              disabled={busy || status !== 'ready' || !cameraReady}
            >
              <Text style={styles.btnText}>{challenge !== null ? 'Capture' : 'Verify'}</Text>
            </Pressable>
          </View>

          <Pressable style={styles.purge} onPress={handlePurge} disabled={busy}>
            <Text style={styles.purgeText}>Purge gallery</Text>
          </Pressable>
        </GlassView>
      </SafeAreaView>

      {busy && (
        <View style={styles.busy} pointerEvents="none">
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  noCam: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B1B33' },
  noCamText: { color: '#CDE7FF', fontSize: 16 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topPill: {
    alignSelf: 'center',
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    overflow: 'hidden',
  },
  topPillText: { color: '#0B1B33', fontWeight: '600', letterSpacing: 0.2 },
  challengeBanner: {
    alignSelf: 'center',
    marginTop: 16,
    paddingHorizontal: 28,
    paddingVertical: 18,
    borderRadius: 24,
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  challengeBannerLabel: { color: '#0EA5E9', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  challengeBannerPrompt: { color: '#0B1B33', fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
  challengeBannerHint: { color: '#48566B', fontSize: 13 },
  panel: {
    margin: 12,
    padding: 20,
    borderRadius: 28,
    gap: 12,
    overflow: 'hidden',
  },
  result: { fontSize: 16, fontWeight: '700', color: '#0B1B33' },
  logBox: { backgroundColor: '#0B1B33', borderRadius: 12, padding: 10, minHeight: 90 },
  logLine: { color: '#8FD3FF', fontFamily: 'Menlo', fontSize: 11 },
  input: {
    borderWidth: 1,
    borderColor: '#C7D3E3',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0B1B33',
    backgroundColor: '#FFFFFF',
  },
  row: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  register: { backgroundColor: '#0EA5E9' },
  verify: { backgroundColor: '#2563EB' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  purge: { alignItems: 'center', paddingVertical: 8 },
  purgeText: { color: '#DC2626', fontWeight: '600' },
  busy: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
});
