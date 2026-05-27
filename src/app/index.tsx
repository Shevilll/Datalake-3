import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedIcon } from '@/components/animated-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { runSelfTest } from '@/faceauth/ort';

export default function HomeScreen() {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const run = async (): Promise<void> => {
    setRunning(true);
    setLines([]);
    const result = await runSelfTest();
    setLines(result);
    setRunning(false);
  };

  const passed = lines.some((l) => l.includes('ALL 3 MODELS'));
  const failed = lines.some((l) => l.startsWith('❌'));
  const badgeStyle = passed ? styles.pass : failed ? styles.fail : styles.pending;
  const badgeLabel = running ? 'RUNNING…' : passed ? 'PASS ✅' : failed ? 'FAIL ❌' : '…';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.hero}>
          <AnimatedIcon />
          <ThemedText type="title" style={styles.title}>
            Datalake FaceAuth
          </ThemedText>
          <ThemedText type="small" style={styles.subtitle}>
            On-device model self-test (Slice 1)
          </ThemedText>
        </View>

        <Pressable
          style={({ pressed }) => [styles.cta, (running || pressed) && styles.ctaPressed]}
          onPress={() => void run()}
          disabled={running}
        >
          <Text style={styles.ctaText}>{running ? 'Running…' : '▶  Run on-device model self-test'}</Text>
        </Pressable>

        {(lines.length > 0 || running) && (
          <View style={[styles.badge, badgeStyle]}>
            <Text style={styles.badgeText}>{badgeLabel}</Text>
          </View>
        )}

        <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
          {lines.map((l, i) => (
            <Text key={i} style={styles.logLine} selectable>
              {l}
            </Text>
          ))}
          {running ? <ActivityIndicator style={{ marginTop: 12 }} color="#CDE7FF" /> : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: {
    flex: 1,
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
  },
  hero: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.three },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center' },
  cta: { backgroundColor: '#2563EB', paddingVertical: 16, borderRadius: 16, alignItems: 'center' },
  ctaPressed: { opacity: 0.6 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  pending: { backgroundColor: '#94A3B8' },
  pass: { backgroundColor: '#16A34A' },
  fail: { backgroundColor: '#DC2626' },
  badgeText: { color: '#FFFFFF', fontWeight: '700' },
  log: { flex: 1, backgroundColor: '#0B1B33', borderRadius: 16, padding: 14 },
  logContent: { gap: 6 },
  logLine: { color: '#CDE7FF', fontFamily: 'Menlo', fontSize: 12 },
});
