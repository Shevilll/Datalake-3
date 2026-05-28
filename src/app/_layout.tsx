// CSPRNG polyfill (DECISIONS.md D10) — installs global.crypto.getRandomValues at app start
// so the randomChallenge() selection in activeLiveness.ts uses a CSPRNG, not Math.random.
import 'react-native-get-random-values';

import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}
