export const LABEL_SETS = {
  xbox: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "Up", "Down", "Left", "Right", "Guide"],
  playstation: ["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Share", "Options", "L3", "R3", "Up", "Down", "Left", "Right", "PS", "Touchpad"],
  generic: Array.from({ length: 18 }, (_, i) => `B${i}`),
};

export const BUTTON_LABELS = LABEL_SETS.xbox;

// Un bouton qui se relâche puis se ré-enfonce plus vite que ça ne peut pas être
// une vraie double-pression humaine, c'est un signe de chatter/contact usé.
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

const REST_SAMPLE_WINDOW_MS = 1000;
const REST_VARIANCE_THRESHOLD = 0.01;
const REST_MAGNITUDE_LIMIT = 0.3;
// Le bruit électrique d'un stick sain reste sous 0.001 au repos, mais la littérature sur
// le stick drift considère un écart jusqu'à 0.05 comme "acceptable", masquable par une
// dead zone normale. On se cale juste sous cette borne pour capter un vrai début de
// dérive sans signaler des manettes saines à cause d'un simple écart de calibration interne.
export const NEUTRAL_DRIFT_WARN_THRESHOLD = 0.045;

// Détecte le point de repos réel d'un stick en échantillonnant sa position brute
// uniquement pendant les phases où elle reste stable (faible variance) sans
// intervention de l'utilisateur, plutôt que de supposer que repos = (0,0). Un stick
// en début d'usure ne revient souvent pas exactement au centre électrique malgré une
// position mécanique apparemment neutre, et ce décalage est trop fin pour être jugé
// fiablement à l'œil sur le canvas.
export class NeutralDriftTracker {
  constructor() {
    this.samples = []; // { x, y, t }
    this.offset = { x: 0, y: 0 };
    this.measured = false;
  }

  update(x, y, now) {
    this.samples.push({ x, y, t: now });
    while (this.samples.length && now - this.samples[0].t > REST_SAMPLE_WINDOW_MS) {
      this.samples.shift();
    }
    if (this.samples.length < 10 || now - this.samples[0].t < REST_SAMPLE_WINDOW_MS) return;

    const xs = this.samples.map((s) => s.x);
    const ys = this.samples.map((s) => s.y);
    const spreadX = Math.max(...xs) - Math.min(...xs);
    const spreadY = Math.max(...ys) - Math.min(...ys);
    if (spreadX > REST_VARIANCE_THRESHOLD || spreadY > REST_VARIANCE_THRESHOLD) return;

    const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
    if (Math.hypot(avgX, avgY) > REST_MAGNITUDE_LIMIT) return;

    this.offset = { x: avgX, y: avgY };
    this.measured = true;
  }

  getOffset() {
    return { x: this.offset.x, y: this.offset.y, magnitude: Math.hypot(this.offset.x, this.offset.y), measured: this.measured };
  }

  reset() {
    this.samples = [];
    this.offset = { x: 0, y: 0 };
    this.measured = false;
  }
}
