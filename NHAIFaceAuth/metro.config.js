// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Bundle TensorFlow.js model weight shards (*.bin) as static assets so they
// can be loaded fully offline via expo-asset / expo-file-system.
config.resolver.assetExts.push('bin');

// @vladmandic/face-api ships a Node build as `main` (uses fs / tfjs-node) and a
// browser/ESM build as `browser`/`module`. Force Metro to prefer the browser
// build so it bundles cleanly in React Native (no Node core deps).
config.resolver.resolverMainFields = ['react-native', 'browser', 'module', 'main'];

module.exports = config;
