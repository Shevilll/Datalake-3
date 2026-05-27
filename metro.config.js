// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle the ONNX models as binary assets so onnxruntime-react-native can load them
// fully offline from the app bundle (C8 / airplane-mode requirement).
config.resolver.assetExts.push('onnx', 'ort');

module.exports = config;
