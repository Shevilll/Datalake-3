// React Native autolinking project config.
//
// Why this file exists: `onnxruntime-react-native` ships a stale `unimodule.json`
// (a legacy Expo "unimodules" marker declaring platforms ios/android). Expo's
// autolinker (expo-modules-autolinking) treats any package with a `unimodule.json`
// as an Expo module and, seeing that ORT also has its own `android/build.gradle`
// with no Expo `android.gradlePath` redirect, DEFERS it ("can't link both at once")
// — so its `OnnxruntimePackage` (a plain RN `ReactPackage`) is never registered.
// The result on Android (bridgeless New Arch): the native module "Onnxruntime"
// does not exist, and `binding.ts`'s `Module.install()` crashes the JS bundle at
// startup. iOS is unaffected (Pods link ORT via its podspec), so we override only
// Android here to force normal RN autolinking of the package.
//
// See DECISIONS.md (D13) for the full investigation.
module.exports = {
  dependencies: {
    'onnxruntime-react-native': {
      platforms: {
        android: {
          sourceDir: 'android',
          packageImportPath: 'import ai.onnxruntime.reactnative.OnnxruntimePackage;',
          packageInstance: 'new OnnxruntimePackage()',
        },
      },
    },
  },
};
