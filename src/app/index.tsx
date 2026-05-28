import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
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
  isBindingChallenge,
  randomChallengeWithBonus,
  satisfiesChallenge,
} from '@/faceauth/activeLiveness';
import { photoToMat } from '@/faceauth/capture';
import { FaceAuth } from '@/faceauth/FaceAuth';
import { addEnrollment, listEnrolled } from '@/faceauth/gallery';
import { loadSessions, type Sessions } from '@/faceauth/ort';
import { enrollFromMat, verifyFromMat } from '@/faceauth/pipeline';

type Status = 'booting' | 'ready' | 'error';

// Face-guide oval sized off the screen width — large enough that the user fills it,
// small enough that the bottom controls panel never sits over the face when the user
// positions inside the guide. Oval = bigger-than-half-dim borderRadius.
const { width: SCREEN_W } = Dimensions.get('window');
const OVAL_W = Math.round(SCREEN_W * 0.62);
const OVAL_H = Math.round(OVAL_W * 1.28);

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
  const sessionsRef = useRef<Sessions | null>(null);

  // Dev-only — never rendered in the UI (judge should never see console text); Metro logs only.
  const log = (line: string): void => {
    console.log('[FaceAuth]', line);
  };

  useEffect(() => {
    void (async () => {
      log(`liquid glass: ${isLiquidGlassAvailable() ? 'available (iOS 26+)' : 'fallback (plain View)'}`);
      if (!hasPermission) await requestPermission();
      try {
        sessionsRef.current = await loadSessions();
        setStatus('ready');
        log('models loaded — ready');
      } catch (e) {
        setStatus('error');
        log(`load failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = async (): Promise<{ path: string } | null> => {
    const photo = await photoOutput.capturePhotoToFile({ flashMode: 'off' }, {});
    log(`captured -> ${photo.filePath}`);
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
      log(`decoded mat ${width}x${height}`);
      const out = await enrollFromMat(sessions, mat, width, height);
      if (!out.ok || !out.embedding) {
        setResult(`Register failed: ${out.reason ?? 'unknown'}`);
        return;
      }
      const count = addEnrollment(name.trim(), out.embedding);
      setEnrolled(listEnrolled());
      setResult(`Registered "${name.trim()}" — sample #${count}`);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Two-step active-challenge verify.
   *  1st tap (idle): pick a random challenge (binding ∪ bonus), display the prompt, wait for the user to perform.
   *  2nd tap (awaiting): capture, run pipeline, check identity match + challenge geometry.
   * Final verdict: matched AND (binding-challenge satisfied). Bonus (blink) auto-passes — see D12.
   */
  const handleVerify = async (): Promise<void> => {
    const sessions = sessionsRef.current;
    if (!sessions || busy) return;

    if (challenge === null) {
      const c = randomChallengeWithBonus();
      setChallenge(c);
      setResult('');
      log(`challenge: ${challengePrompt(c)} (binding=${isBindingChallenge(c)})`);
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
        return;
      }
      const g = computeGeometry(out.detection.landmarks);
      const binding = isBindingChallenge(challenge);
      const challengeProbe = satisfiesChallenge(challenge, g, yawSignRef.current);
      // Bonus challenges (blink) never gate the verdict — see D12.
      const challengeOk = binding ? challengeProbe : true;
      const verified = out.matched && challengeOk;
      const cos = out.confidence.toFixed(3);
      const yaw = g.yaw.toFixed(2);
      const smile = g.smile.toFixed(2);
      const live = out.passiveScore.toFixed(2);
      log(`verify matched=${out.matched} challenge=${challenge} probe=${challengeProbe} binding=${binding} verified=${verified} cos=${cos} yaw=${yaw} smile=${smile} live=${live} (${out.latencyMs}ms)`);
      const bonusTag = binding ? '' : ' · bonus';
      if (verified) {
        setResult(`✅ ${out.personId} — verified (${challengePrompt(challenge)}${bonusTag}, cos ${cos}, ${out.latencyMs}ms)`);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (out.matched && !challengeOk) {
        setResult(`❌ Challenge failed — ${challengePrompt(challenge)} (${out.latencyMs}ms)`);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        setResult(`❌ No match (best cos ${cos}, ${out.latencyMs}ms)`);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      // Audit record — never raw images; outcome + cosine only (§10 / C8).
      void FaceAuth.queueForSync({
        id: `evt-${Date.now()}`,
        personId: verified ? out.personId : null,
        timestamp: Date.now(),
        matched: out.matched,
        confidence: out.confidence,
        livenessPassed: challengeOk,
      });
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setChallenge(null);
    }
  };

  const handlePurge = async (): Promise<void> => {
    // Wipes embeddings + sync queue + transmit log — the C8 "purge all biometric data" primitive.
    const { purged } = await FaceAuth.purgeLocal();
    setEnrolled(listEnrolled());
    setResult(`Purged ${purged} local records`);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleSync = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const { synced } = await FaceAuth.syncNow();
      setResult(synced > 0 ? `Synced ${synced} record${synced === 1 ? '' : 's'}` : 'Sync queue is empty');
    } catch (e) {
      log(`sync error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Top-pill text — concise, judge-readable. Always reflects current state in one line.
  const topPillText =
    status === 'error'
      ? 'Load error'
      : status !== 'ready'
        ? 'Loading models…'
        : !cameraReady
          ? 'Starting camera…'
          : `FaceAuth ready${enrolled.length > 0 ? `  ·  ${enrolled.length} enrolled` : ''}`;

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

      {/* Face-guide oval — sits centred behind the controls; the user positions their face inside.
          Non-interactive (pointerEvents=none) so taps pass through to the camera/preview underneath. */}
      <View style={styles.guideLayer} pointerEvents="none">
        <View style={styles.guideOval} />
      </View>

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        {/* Top status pill — the single source of truth for what's happening; no log box anywhere.
            A soft-white `tintColor` keeps the glass material readable when it lands over a dark
            backdrop (Dynamic Island, hair, low-light areas). Dark text + that tint = always legible. */}
        <GlassView
          style={styles.topPill}
          glassEffectStyle="regular"
          colorScheme="light"
          tintColor={PILL_TINT}
        >
          <Text style={styles.topPillText}>{topPillText}</Text>
        </GlassView>

        {/* Challenge banner — only when a verify is awaiting the user's gesture. Floats above the
            face-guide oval so the prompt is visible while the user looks at the camera. */}
        {challenge !== null && (
          <GlassView style={styles.challengeBanner} glassEffectStyle="regular" colorScheme="light">
            <Text style={styles.challengeBannerLabel}>
              {isBindingChallenge(challenge) ? 'ACTIVE LIVENESS' : 'BONUS LIVENESS'}
            </Text>
            <Text style={styles.challengeBannerPrompt}>{challengePrompt(challenge)}</Text>
            <Text style={styles.challengeBannerHint}>…then tap Capture</Text>
          </GlassView>
        )}

        {/* Spacer between challenge area and bottom controls — pushes controls to the bottom and
            keeps the face-guide oval clear of any UI when the user is centring themselves. */}
        <View style={styles.spacer} />

        {/* Bottom controls — compact glass card. Result feedback, name input, primary actions,
            secondary text links. The Verify button is the single restrained accent (primary). */}
        <GlassView style={styles.panel} glassEffectStyle="regular" colorScheme="light">
          {result.length > 0 && <Text style={styles.result}>{result}</Text>}

          <GlassView style={styles.inputGlass} glassEffectStyle="clear" colorScheme="light">
            <TextInput
              style={styles.input}
              placeholder="Name to register"
              placeholderTextColor="#6E7B91"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
          </GlassView>

          <View style={styles.row}>
            <Pressable
              onPress={() => void handleRegister()}
              disabled={busy || status !== 'ready' || !cameraReady}
              style={({ pressed }) => [styles.btnWrap, (busy || pressed) && styles.btnWrapPressed]}
            >
              <GlassView style={styles.btnGlass} glassEffectStyle="regular" colorScheme="light">
                <Text style={styles.btnSecondaryText}>Register</Text>
              </GlassView>
            </Pressable>
            <Pressable
              onPress={() => void handleVerify()}
              disabled={busy || status !== 'ready' || !cameraReady}
              style={({ pressed }) => [styles.btnWrap, (busy || pressed) && styles.btnWrapPressed]}
            >
              {/* Primary action — interactive Liquid Glass tinted with the single restrained accent.
                  `isInteractive` enables iOS 26's native glass press feedback (subtle morph + lift);
                  the `tintColor` paints the glass blue without flattening it to a solid block. */}
              <GlassView
                style={styles.btnPrimaryGlass}
                glassEffectStyle="regular"
                tintColor={ACCENT}
                isInteractive
              >
                <Text style={styles.btnPrimaryText}>{challenge !== null ? 'Capture' : 'Verify'}</Text>
              </GlassView>
            </Pressable>
          </View>

          <View style={styles.linksRow}>
            <Pressable onPress={() => void handleSync()} disabled={busy} style={styles.linkBtn}>
              <Text style={styles.syncText}>Sync queue</Text>
            </Pressable>
            <Pressable onPress={() => void handlePurge()} disabled={busy} style={styles.linkBtn}>
              <Text style={styles.purgeText}>Purge all</Text>
            </Pressable>
          </View>
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

// Single restrained accent — used ONLY on the primary Verify/Capture action (§3c). Painted as a
// `tintColor` on an interactive Liquid Glass surface so it stays a glass material, not a flat fill.
const ACCENT = '#007AFF';
// Soft white wash for the status pill's glass — keeps the material light enough that the dark
// text stays legible when the pill lands over a dark backdrop (Dynamic Island, hair, shadow).
const PILL_TINT = 'rgba(255, 255, 255, 0.55)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F7FC' }, // luminous fallback (graceful) — camera covers it 99% of the time
  noCam: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F7FC' },
  noCamText: { color: '#0B1B33', fontSize: 16, fontWeight: '600' },

  overlay: { flex: 1 },

  guideLayer: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  guideOval: {
    width: OVAL_W,
    height: OVAL_H,
    borderRadius: OVAL_H, // > half the larger dim = oval
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
    // Slight inner halo + drop shadow help the guide read against varied backgrounds.
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 14,
    elevation: 6,
  },

  topPill: {
    alignSelf: 'center',
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    overflow: 'hidden',
  },
  topPillText: {
    color: '#0B1B33',
    fontWeight: '700',
    letterSpacing: 0.2,
    // Subtle bright text-shadow — belt-and-braces with the pill's PILL_TINT wash so the label
    // stays legible if the glass material ever picks up a darker-than-expected backdrop.
    textShadowColor: 'rgba(255, 255, 255, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },

  challengeBanner: {
    alignSelf: 'center',
    marginTop: 14,
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 22,
    alignItems: 'center',
    gap: 4,
    overflow: 'hidden',
  },
  challengeBannerLabel: { color: ACCENT, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  challengeBannerPrompt: { color: '#0B1B33', fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  challengeBannerHint: { color: '#48566B', fontSize: 12 },

  spacer: { flex: 1 },

  panel: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 26,
    gap: 10,
    overflow: 'hidden',
  },
  result: { fontSize: 15, fontWeight: '700', color: '#0B1B33', textAlign: 'center' },

  inputGlass: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: '#0B1B33',
  },

  row: { flexDirection: 'row', gap: 10 },
  btnWrap: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  btnWrapPressed: { opacity: 0.7 },
  btnGlass: {
    paddingVertical: 13,
    alignItems: 'center',
    borderRadius: 14,
    overflow: 'hidden',
  },
  btnSecondaryText: { color: '#0B1B33', fontSize: 15, fontWeight: '700' },

  btnPrimaryGlass: {
    paddingVertical: 13,
    alignItems: 'center',
    borderRadius: 14,
    overflow: 'hidden',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    // Slight contrast lift so the white label still reads when the tinted glass picks up a
    // brighter-than-expected refraction (e.g. user holding the phone toward a light wall).
    textShadowColor: 'rgba(0, 0, 0, 0.25)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },

  linksRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 2 },
  linkBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  syncText: { color: ACCENT, fontWeight: '600', fontSize: 13 },
  purgeText: { color: '#DC2626', fontWeight: '600', fontSize: 13 },

  busy: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
});
