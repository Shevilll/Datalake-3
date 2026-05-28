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
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      push(`register error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (): Promise<void> => {
    const sessions = sessionsRef.current;
    if (!sessions || busy) return;
    setBusy(true);
    setResult('');
    try {
      const shot = await capture();
      if (!shot) return;
      const { mat, width, height } = await photoToMat(shot.path);
      const out = await verifyFromMat(sessions, mat, width, height);
      if (!out.ok) {
        setResult(`No match: ${out.reason ?? ''}`);
        push(`verify: ${out.reason ?? 'no face'} (${out.latencyMs}ms)`);
        return;
      }
      const conf = out.confidence.toFixed(3);
      setResult(
        out.matched
          ? `✅ ${out.personId}  (cos ${conf}, ${out.latencyMs}ms)`
          : `❌ no match  (best cos ${conf}, ${out.latencyMs}ms)`,
      );
      push(`verify matched=${out.matched} id=${out.personId} cos=${conf} ${out.latencyMs}ms`);
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      push(`verify error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
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
        <View style={styles.topPill}>
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
        </View>

        <View style={styles.panel}>
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
              <Text style={styles.btnText}>Verify</Text>
            </Pressable>
          </View>

          <Pressable style={styles.purge} onPress={handlePurge} disabled={busy}>
            <Text style={styles.purgeText}>Purge gallery</Text>
          </Pressable>
        </View>
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
    marginTop: 8,
    backgroundColor: 'rgba(11,27,51,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  topPillText: { color: '#FFFFFF', fontWeight: '600' },
  panel: {
    margin: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: 'rgba(244,248,255,0.94)',
    gap: 10,
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
