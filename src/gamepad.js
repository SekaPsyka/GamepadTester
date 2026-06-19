export const LABEL_SETS = {
  xbox: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "Up", "Down", "Left", "Right", "Guide"],
  playstation: ["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Share", "Options", "L3", "R3", "Up", "Down", "Left", "Right", "PS", "Touchpad"],
  generic: Array.from({ length: 18 }, (_, i) => `B${i}`),
};

export const BUTTON_LABELS = LABEL_SETS.xbox;

// Un bouton qui se relâche puis se ré-enfonce plus vite que ça ne peut pas être
// une vraie double-pression humaine — c'est un signe de chatter/contact usé.
export const CHATTER_THRESHOLD_MS = 60;

export function detectControllerType(id = "") {
  const lower = id.toLowerCase();
  if (/xbox|xinput/.test(lower)) return "xbox";
  if (/dualshock|dualsense|playstation|ps[345]/.test(lower)) return "playstation";
  return "generic";
}

export function getLabelsFor(id) {
  return LABEL_SETS[detectControllerType(id)];
}

// Radial dead zone with inner cut-off and outer saturation.
// inner/outer are 0..1 fractions of the stick's max travel.
export function applyDeadzone(x, y, inner, outer) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < inner) return { x: 0, y: 0, magnitude: 0 };
  const clampedMag = Math.min(magnitude, 1);
  const scaled = Math.min(1, Math.max(0, (clampedMag - inner) / Math.max(0.0001, outer - inner)));
  const dirX = x / magnitude;
  const dirY = y / magnitude;
  return { x: dirX * scaled, y: dirY * scaled, magnitude: scaled };
}

export function getConnectedGamepads() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  return Array.from(pads).filter(Boolean);
}

export function getPrimaryGamepad() {
  return getConnectedGamepads()[0] || null;
}
