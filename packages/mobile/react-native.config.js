// Bundled OFL fonts (Fraunces serif for display/headings, Inter for body) shipped
// with the app so type renders identically on every Android device (API 24+) and
// iOS — no system-font fallback. `react-native-asset` copies these into
// android/app/src/main/assets/fonts and the iOS bundle (UIAppFonts). Re-run after
// adding a weight:  npx react-native-asset
module.exports = {
  assets: ["./src/assets/fonts"],
};
