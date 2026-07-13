export const LABEL_SETS = {
  xbox: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "Stick G", "Stick D", "Haut", "Bas", "Gauche", "Droite", "Guide"],
  playstation: ["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Share", "Options", "L3", "R3", "Haut", "Bas", "Gauche", "Droite", "PS", "Pavé tactile"],
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

// Les gâchettes analogiques ont leur propre diagnostic de stabilité. Les traiter aussi
// comme des boutons digitaux dans l'observation passive transforme les passages répétés
// autour du seuil en faux doubles déclenchements.
export function isPassiveChatterButton(index) {
  return !TRIGGER_BUTTON_INDICES.has(index);
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
export const TRIGGER_TARGET_MIN = 0.35;
export const TRIGGER_TARGET_MAX = 0.65;
export const TRIGGER_SETTLE_MS = 700;
// On cherche ici l'arrêt du mouvement volontaire, pas un signal parfaitement plat.
// Comparer les moyennes des deux moitiés laisse passer un capteur qui oscille autour
// d'un palier afin que ces oscillations soient bien observées pendant la vraie mesure.
const TRIGGER_SETTLE_DRIFT_TOLERANCE = 0.02;
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
// signe d'un potentiomètre/capteur qui décroche. Mais un tremblement involontaire produit
// le même genre d'écart brut qu'un défaut de capteur: ce seuil seul ne suffit pas à
// trancher, voir TRIGGER_ISOLATED_STEP_LIMIT ci-dessous.
export const TRIGGER_STABILITY_BAD_RANGE = 0.05;
// Un unique saut sur tout un maintien de TRIGGER_REQUIRED_HOLD_MS (un hoquet Bluetooth,
// une frame ratée) ne dit rien sur l'état du capteur — c'est la répétition du saut qui
// distingue un vrai motif (tremblement ou défaut) d'un accident de mesure isolé.
const TRIGGER_ISOLATED_STEP_LIMIT = 1;

// Centralise l'interprétation d'une mesure de stabilité de gâchette: un écart au-delà du
// seuil "instable" causé par un saut isolé est requalifié en bruit "à confirmer" plutôt
// que classé directement comme un défaut matériel.
export function triggerStabilityGrade(result) {
  if (!result.measured) return { key: "na", isolated: false };
  if (result.range <= TRIGGER_STABILITY_WARN_RANGE) return { key: "excellent", isolated: false };
  if (result.range <= TRIGGER_STABILITY_BAD_RANGE) return { key: "fair", isolated: false };
  if (result.stepCount <= TRIGGER_ISOLATED_STEP_LIMIT) return { key: "fair", isolated: true };
  return { key: "poor", isolated: false };
}

// Détecte si une gâchette analogique tenue à un palier fixe pendant TRIGGER_REQUIRED_HOLD_MS
// produit un signal lisse ou "en escalier" (paliers irréguliers, signe d'un capteur usé).
// Une fois une mesure validée, elle reste affichée (sticky) même après relâchement de la
// gâchette: sans ça, le résultat disparaissait dès qu'on arrêtait de tenir, juste avant
// l'export du rapport.
export class TriggerStabilityTracker {
  constructor() {
    this.samples = []; // Échantillons de la mesure, sans la mise en position.
    this.settleSamples = [];
    this.holdStartedAt = null;
    this.locked = false;
    this.phase = "idle";
    this.currentValue = 0;
    this.notice = null;
    this.result = { measured: false, range: 0, stepCount: 0, level: 0 };
  }

  update(value, now) {
    this.currentValue = value;
    if (value < TRIGGER_ENGAGED_MIN) {
      // Gâchette relâchée: on abandonne la tentative en cours mais on garde la dernière
      // mesure déjà validée plutôt que de l'effacer.
      this.samples = [];
      this.settleSamples = [];
      this.holdStartedAt = null;
      this.locked = false;
      this.phase = this.result.measured ? "complete" : "idle";
      this.notice = null;
      return;
    }
    if (this.locked) return;

    const inTarget = value >= TRIGGER_TARGET_MIN && value <= TRIGGER_TARGET_MAX;
    if (this.holdStartedAt == null) {
      if (!inTarget) {
        this.settleSamples = [];
        this.phase = "positioning";
        return;
      }

      this.phase = "stabilizing";
      this.settleSamples.push({ value, t: now });
      while (this.settleSamples.length > 1 && now - this.settleSamples[1].t >= TRIGGER_SETTLE_MS) {
        this.settleSamples.shift();
      }
      if (this.settleSamples.length < 4 || now - this.settleSamples[0].t < TRIGGER_SETTLE_MS) return;

      const settleValues = this.settleSamples.map((sample) => sample.value);
      const settleMid = Math.floor(settleValues.length / 2);
      const settleFirstAvg = settleValues.slice(0, settleMid).reduce((sum, sample) => sum + sample, 0) / settleMid;
      const settleSecondValues = settleValues.slice(settleMid);
      const settleSecondAvg = settleSecondValues.reduce((sum, sample) => sum + sample, 0) / settleSecondValues.length;
      if (Math.abs(settleSecondAvg - settleFirstAvg) > TRIGGER_SETTLE_DRIFT_TOLERANCE) return;

      this.holdStartedAt = now;
      this.samples = [{ value, t: now }];
      this.settleSamples = [];
      this.phase = "measuring";
      this.notice = null;
      return;
    }

    this.samples.push({ value, t: now });

    if (now - this.holdStartedAt < TRIGGER_REQUIRED_HOLD_MS) return;

    const values = this.samples.map((s) => s.value);
    const mid = Math.floor(values.length / 2);
    const firstHalfAvg = values.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const secondHalfValues = values.slice(mid);
    const secondHalfAvg = secondHalfValues.reduce((a, b) => a + b, 0) / secondHalfValues.length;
    if (Math.abs(secondHalfAvg - firstHalfAvg) > TRIGGER_HOLD_TOLERANCE) {
      // Une dérive lente sur toute la capture ressemble davantage à un changement de
      // position du doigt qu'à un bruit de capteur. On recommence explicitement la
      // préparation au lieu de laisser le compte à rebours bloqué à zéro.
      this.samples = [];
      this.holdStartedAt = null;
      this.settleSamples = inTarget ? [{ value, t: now }] : [];
      this.phase = inTarget ? "stabilizing" : "positioning";
      this.notice = "moved";
      return;
    }

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const range = Math.max(...values) - Math.min(...values);
    let stepCount = 0;
    for (let i = 1; i < values.length; i++) {
      if (Math.abs(values[i] - values[i - 1]) > TRIGGER_STEP_DELTA) stepCount++;
    }

    this.result = { measured: true, range, stepCount, level: avg };
    this.locked = true;
    this.phase = "complete";
    this.notice = null;
  }

  // Fraction (0..1) de la durée de maintien requise déjà écoulée, pour afficher un
  // compte à rebours pendant que l'utilisateur tient la gâchette.
  getProgress(now) {
    if (this.locked) return 1;
    if (this.phase === "measuring") {
      return Math.min(1, (now - this.holdStartedAt) / TRIGGER_REQUIRED_HOLD_MS);
    }
    if (this.phase === "stabilizing" && this.settleSamples.length) {
      return Math.min(1, (now - this.settleSamples[0].t) / TRIGGER_SETTLE_MS);
    }
    return 0;
  }

  getStatus(now) {
    const progress = this.getProgress(now);
    const durationMs = this.phase === "stabilizing" ? TRIGGER_SETTLE_MS : TRIGGER_REQUIRED_HOLD_MS;
    return {
      phase: this.phase,
      progress,
      remainingMs: (this.phase === "stabilizing" || this.phase === "measuring")
        ? Math.max(0, durationMs * (1 - progress))
        : 0,
      currentValue: this.currentValue,
      notice: this.notice,
      retesting: this.result.measured && this.isAttempting(),
    };
  }

  // Une tentative est en cours (gâchette tenue, pas encore validée) — y compris quand un
  // résultat précédent est déjà affiché, pour distinguer "nouvelle mesure en cours" de
  // "résultat de la dernière mesure".
  isAttempting() {
    return ["positioning", "stabilizing", "measuring"].includes(this.phase) && !this.locked;
  }

  getResult() {
    return { ...this.result };
  }

  reset() {
    this.samples = [];
    this.settleSamples = [];
    this.holdStartedAt = null;
    this.locked = false;
    this.phase = "idle";
    this.currentValue = 0;
    this.notice = null;
    this.result = { measured: false, range: 0, stepCount: 0, level: 0 };
  }
}
