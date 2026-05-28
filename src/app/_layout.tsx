// CSPRNG polyfill (DECISIONS.md D10) — installs global.crypto.getRandomValues at app start
// so the randomChallenge() selection in activeLiveness.ts uses a CSPRNG, not Math.random.
import 'react-native-get-random-values';

import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';

/**
 * Root layout — single screen (the FaceAuth camera). No tab bar (we removed the template's
 * Home/Explore tabs since we ship one screen). Theme is locked to light (CLAUDE.md §3c).
 */
export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
