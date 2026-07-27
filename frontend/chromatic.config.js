// chromatic.config.js — Chromatic visual regression configuration (TEST-104)
// https://www.chromatic.com/docs/configuration

/** @type {import('@chromatic-com/storybook').ChromaticConfig} */
module.exports = {
  // Capture screenshots at all three required viewports
  viewports: [375, 768, 1280],

  // Auto-accept baseline snapshots on merges to main
  autoAcceptChanges: "main",

  // Only snapshot stories that changed in the current PR
  onlyChanged: true,

  // Delay (ms) before capturing — allows CSS transitions to settle
  delay: 300,

  // Fail the build if unapproved visual changes are detected
  exitZeroOnChanges: false,
};
