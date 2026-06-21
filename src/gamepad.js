export const LABEL_SETS = {
  xbox: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "Up", "Down", "Left", "Right", "Guide"],
  playstation: ["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Share", "Options", "L3", "R3", "Up", "Down", "Left", "Right", "PS", "Touchpad"],
  generic: Array.from({ length: 18 }, (_, i) => `B${i}`),
};

export const BUTTON_LABELS = LABEL_SETS.xbox;

// Un bouton qui se relâche puis se ré-enfonce plus vite que ça ne peut pas être
// une vraie double-pression humaine, c'est un signe de chatter/contact usé.
export const CHATTER_THRESHOLD_MS = 60;

// LT/RT (L2/R2) sont toujours aux index 6 et 7 dans le mapping Gamepad API "standard",
// quelle que soit la marque détectée.
export const TRIGGER_BUTTON_INDICES = new Set([6, 7]);

export const PRESS_THRESHOLD = 0.08;
// Une gâchette est un capteur analogique continu, pas un switch binaire: comparer sa
// valeur à un seuil unique fait osciller l'état "pressé" autour de ce seuil au moindre
// bruit de capteur ou jeu mécanique du ressort, et se lit à tort comme du chatter. On
// presse plus haut qu'on ne relâche (hystérésis) pour absorber ce bruit, sans masquer
// une oscillation large et rapide qui pointerait vers un vrai défaut.
const TRIGGER_PRESS_THRESHOLD = 0.12;
const TRIGGER_RELEASE_THRESHOLD = 0.05;

// On ignore btn.pressed pour les gâchettes: ce booléen vient déjà d'un seuillage interne
// au navigateur/pilote, potentiellement aussi bruité que le nôtre, et il contournerait
// l'hystérésis si on l'utilisait en OR comme pour les boutons digitaux.
export function isButtonPressed(btn, index, wasPressed) {
  if (!btn) return false;
  if (TRIGGER_BUTTON_INDICES.has(index)) {
    return wasPressed ? btn.value > TRIGGER_RELEASE_THRESHOLD : btn.value > TRIGGER_PRESS_THRESHOLD;
  }
  return btn.pressed || btn.value > PRESS_THRESHOLD;
}

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
// Au-delà de 0.12, le décalage dépasse largement la dead zone par défaut (0.1 sur la
// plupart des manettes) et devient un vrai input fantôme perceptible en jeu, plutôt
// qu'un simple début de dérive masqué par la dead zone.
export const NEUTRAL_DRIFT_BAD_THRESHOLD = 0.12;

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
    // On ne purge le plus vieil échantillon que si le suivant couvre déjà la fenêtre à
    // lui seul: avec un pas d'échantillonnage régulier, purger dès qu'on dépasse la
    // fenêtre fait osciller l'âge du plus vieil échantillon juste sous le seuil pour
    // toujours, sans jamais l'atteindre (effet de quantification).
    while (this.samples.length > 1 && now - this.samples[1].t >= REST_SAMPLE_WINDOW_MS) {
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

// Mesurer la "stabilité" à 0 (repos) n'a pas de sens, ce n'est pas un signal analogique
// engagé.
const TRIGGER_ENGAGED_MIN = 0.15;
// Durée à tenir avant de valider la mesure: assez longue pour moyenner le bruit sur
// plusieurs échantillons, assez courte pour rester confortable à tenir à la main.
export const TRIGGER_REQUIRED_HOLD_MS = 5000;
// Un mouvement volontaire (l'utilisateur presse ou relâche progressivement, ou est en
// train de positionner son doigt) ferait varier la valeur sur toute la tentative sans
// que ce soit un défaut de capteur. On ne valide la tentative que si la position n'a
// pas dérivé entre sa première et sa seconde moitié, indépendamment du bruit instantané.
const TRIGGER_HOLD_TOLERANCE = 0.04;
// Un saut net (escalier) entre deux frames consécutives n'a rien à voir avec le bruit
// continu d'un capteur sain.
const TRIGGER_STEP_DELTA = 0.02;
// Le bruit résiduel d'un capteur de gâchette sain, doigt tenu stable, reste très fin.
export const TRIGGER_STABILITY_WARN_RANGE = 0.02;
// Au-delà, l'amplitude dépasse largement ce qu'un tremblement de doigt peut expliquer:
// signe d'un potentiomètre/capteur qui décroche.
export const TRIGGER_STABILITY_BAD_RANGE = 0.05;

// Détecte si une gâchette analogique tenue à un palier fixe pendant TRIGGER_REQUIRED_HOLD_MS
// produit un signal lisse ou "en escalier" (paliers irréguliers, signe d'un capteur usé).
// Une fois une mesure validée, elle reste affichée (sticky) même après relâchement de la
// gâchette: sans ça, le résultat disparaissait dès qu'on arrêtait de tenir, juste avant
// l'export du rapport.
export class TriggerStabilityTracker {
  constructor() {
    this.samples = []; // { value, t }, vidé à chaque relâchement
    this.holdStartedAt = null;
    this.locked = false;
    this.result = { measured: false, range: 0, stepCount: 0, level: 0 };
  }

  update(value, now) {
    if (value < TRIGGER_ENGAGED_MIN) {
      // Gâchette relâchée: on abandonne la tentative en cours mais on garde la dernière
      // mesure déjà validée plutôt que de l'effacer.
      this.samples = [];
      this.holdStartedAt = null;
      this.locked = false;
      return;
    }
    if (this.locked) return;
    if (this.holdStartedAt == null) this.holdStartedAt = now;
    this.samples.push({ value, t: now });

    if (now - this.holdStartedAt < TRIGGER_REQUIRED_HOLD_MS) return;

    const values = this.samples.map((s) => s.value);
    const mid = Math.floor(values.length / 2);
    const firstHalfAvg = values.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const secondHalfValues = values.slice(mid);
    const secondHalfAvg = secondHalfValues.reduce((a, b) => a + b, 0) / secondHalfValues.length;
    if (Math.abs(secondHalfAvg - firstHalfAvg) > TRIGGER_HOLD_TOLERANCE) return;

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const range = Math.max(...values) - Math.min(...values);
    let stepCount = 0;
    for (let i = 1; i < values.length; i++) {
      if (Math.abs(values[i] - values[i - 1]) > TRIGGER_STEP_DELTA) stepCount++;
    }

    this.result = { measured: true, range, stepCount, level: avg };
    this.locked = true;
  }

  // Fraction (0..1) de la durée de maintien requise déjà écoulée, pour afficher un
  // compte à rebours pendant que l'utilisateur tient la gâchette.
  getProgress(now) {
    if (this.locked) return 1;
    if (this.holdStartedAt == null) return 0;
    return Math.min(1, (now - this.holdStartedAt) / TRIGGER_REQUIRED_HOLD_MS);
  }

  // Une tentative est en cours (gâchette tenue, pas encore validée) — y compris quand un
  // résultat précédent est déjà affiché, pour distinguer "nouvelle mesure en cours" de
  // "résultat de la dernière mesure".
  isAttempting() {
    return this.holdStartedAt != null && !this.locked;
  }

  getResult() {
    return { ...this.result };
  }

  reset() {
    this.samples = [];
    this.holdStartedAt = null;
    this.locked = false;
    this.result = { measured: false, range: 0, stepCount: 0, level: 0 };
  }
}
