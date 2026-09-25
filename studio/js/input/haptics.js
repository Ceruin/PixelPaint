// Vibration API wrapper (Android/Chromium). No-ops where unsupported or disabled.
export const haptics = {
  enabled: true,
  pulse(ms = 8) { if (this.enabled && navigator.vibrate) navigator.vibrate(ms); },
  tick() { this.pulse(2); },
  success() { this.pulse([10, 40, 10]); },
};
