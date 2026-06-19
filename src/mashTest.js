import { CHATTER_THRESHOLD_MS } from "./gamepad.js";

// Un écart anormalement long entre deux frames (onglet en arrière-plan, throttling
// du navigateur, pause GC...) peut faire manquer un relâché/ré-appui ou au contraire
// fusionner deux frames en un faux chatter. Un tel écart rend la mesure du bouton en
// cours peu fiable, indépendamment du résultat brut.
const STALL_GAP_MS = 100;

// Séquence de test "mashing": pour chaque bouton de la liste, compte les appuis
// pendant une fenêtre de temps fixe, puis passe au suivant. Sert à mesurer la
// réactivité par bouton et à détecter le chatter (relâche -> ré-appui trop rapide).
export class MashSequenceTest {
  constructor(buttons, durationMs) {
    this.queue = buttons; // [{ index, label }]
    this.durationMs = durationMs;
    this.currentIdx = 0;
    this.results = [];
    this.windowStart = null;
    this.pressCount = 0;
    this.chatterCount = 0;
    this.prevPressed = false;
    this.lastReleaseTime = null;
    this.stallCount = 0;
    this.maxStallGapMs = 0;
    this.finished = this.queue.length === 0;
  }

  get currentButton() {
    return this.queue[this.currentIdx] || null;
  }

  // À appeler à chaque frame avec le tableau pad.buttons, un timestamp (performance.now())
  // et l'écart depuis la frame précédente. gamepadTimestamp est l'horodatage natif
  // (pad.timestamp) du dernier état lu par le driver: plus précis que le temps de la
  // frame rAF pour dater les transitions presse/relâche, car il ne dépend pas du moment
  // où le navigateur a daigné exécuter la frame. On retombe sur `now` s'il est absent.
  // Le chrono ne démarre qu'au premier appui détecté sur le bouton courant.
  feed(padButtons, now, frameGapMs = 0, gamepadTimestamp = null) {
    if (this.finished) return;

    if (this.windowStart != null && frameGapMs > STALL_GAP_MS) {
      this.stallCount++;
      if (frameGapMs > this.maxStallGapMs) this.maxStallGapMs = frameGapMs;
    }

    const eventTime = Number.isFinite(gamepadTimestamp) && gamepadTimestamp > 0 ? gamepadTimestamp : now;

    const current = this.currentButton;
    const btn = padButtons[current.index];
    const pressed = btn ? btn.pressed || btn.value > 0.08 : false;

    if (pressed && !this.prevPressed) {
      if (this.windowStart == null) this.windowStart = eventTime;
      this.pressCount++;
      if (this.lastReleaseTime != null && eventTime - this.lastReleaseTime < CHATTER_THRESHOLD_MS) {
        this.chatterCount++;
      }
    }
    if (!pressed && this.prevPressed) {
      this.lastReleaseTime = eventTime;
    }
    this.prevPressed = pressed;

    if (this.windowStart != null && eventTime - this.windowStart >= this.durationMs) {
      this._finalizeCurrent();
      this._advance();
    }
  }

  _finalizeCurrent() {
    const { index, label } = this.currentButton;
    this.results.push({
      index,
      label,
      pressCount: this.pressCount,
      chatterCount: this.chatterCount,
      pressesPerSecond: this.pressCount / (this.durationMs / 1000),
      reliable: this.stallCount === 0,
      stallCount: this.stallCount,
      maxStallGapMs: Math.round(this.maxStallGapMs),
    });
  }

  _advance() {
    this.currentIdx++;
    this.pressCount = 0;
    this.chatterCount = 0;
    this.prevPressed = false;
    this.lastReleaseTime = null;
    this.windowStart = null;
    this.stallCount = 0;
    this.maxStallGapMs = 0;
    if (this.currentIdx >= this.queue.length) {
      this.finished = true;
    }
  }

  abort() {
    this.finished = true;
  }

  progressFraction(now) {
    if (this.windowStart == null || this.finished) return 0;
    return Math.min(1, (now - this.windowStart) / this.durationMs);
  }
}

// Un peu de chatter est normal: tout switch mécanique rebondit légèrement à la fermeture
// (typiquement 5-20ms, déjà filtré par notre seuil de détection à 60ms). Ce qui distingue
// un bruit ponctuel d'un vrai défaut, c'est le TAUX de chatter par rapport au nombre
// d'appuis, pas un compte brut — 1 événement sur 200 appuis n'a rien à voir avec 1 sur 10.
export const RELIABILITY_GRADES = {
  excellent: { key: "excellent", label: "Excellent" },
  good: { key: "good", label: "Bon" },
  fair: { key: "fair", label: "Moyen" },
  poor: { key: "poor", label: "Mauvais" },
  na: { key: "na", label: "N/A" },
};

// À 5 appuis, 1 seul chatter (20% de taux) suffisait à classer un bouton "Mauvais" —
// un accident de mesure isolé pesait alors autant qu'un vrai défaut. 20 appuis reste
// largement atteignable même sur la durée de test la plus courte (5s) avec un mashing
// normal, tout en rendant un chatter isolé statistiquement moins déterminant.
const MIN_PRESSES_FOR_GRADE = 20;
const FAIR_RATE_THRESHOLD = 0.02;
const POOR_RATE_THRESHOLD = 0.08;

export function chatterRate(chatterCount, pressCount) {
  return pressCount > 0 ? chatterCount / pressCount : 0;
}

export function gradeForChatter(chatterCount, pressCount) {
  if (pressCount < MIN_PRESSES_FOR_GRADE) return RELIABILITY_GRADES.na;
  const rate = chatterRate(chatterCount, pressCount);
  if (rate === 0) return RELIABILITY_GRADES.excellent;
  if (rate <= FAIR_RATE_THRESHOLD) return RELIABILITY_GRADES.good;
  if (rate <= POOR_RATE_THRESHOLD) return RELIABILITY_GRADES.fair;
  return RELIABILITY_GRADES.poor;
}

// Un grade "Mauvais" isolé sur un bouton ne veut pas dire la même chose qu'un grade
// "Mauvais" sur la moitié des boutons: le premier est souvent un faux contact ponctuel,
// le second pointe vers un vrai défaut matériel (ou un souci de driver/connexion qui
// touche plusieurs boutons sans rapport mécanique entre eux). On distingue les deux
// plutôt que de réduire le verdict à une moyenne globale, qui gomme cette différence.
export function buildMashVerdict(results) {
  const graded = results.filter((r) => gradeForChatter(r.chatterCount, r.pressCount).key !== "na");
  if (graded.length === 0) {
    return { tone: "neutral", text: "Pas assez d'appuis enregistrés pour conclure sur la fiabilité des boutons — reteste avec un mashing plus soutenu." };
  }

  const problematic = graded.filter((r) => {
    const key = gradeForChatter(r.chatterCount, r.pressCount).key;
    return key === "fair" || key === "poor";
  });

  if (problematic.length === 0) {
    return { tone: "ok", text: "Manette fiable: aucun signe d'usure détecté sur les boutons testés." };
  }

  const ratio = problematic.length / graded.length;
  if (ratio >= 0.7) {
    return {
      tone: "bad",
      text: `Chatter détecté sur la quasi-totalité des boutons testés (${problematic.length}/${graded.length}) — ce profil est plutôt caractéristique d'un problème matériel (switch, carte, connexion) que de faux positifs isolés.`,
    };
  }

  const labels = problematic.map((r) => r.label).join(", ");
  if (problematic.length <= 2) {
    return {
      tone: "warn",
      text: `Résultat globalement bon. Seul(s) ${labels} montre(nt) un taux de chatter élevé — ça peut venir d'un contact qui s'use, mais aussi d'un faux contact ponctuel. Reteste ce(s) bouton(s) avant de conclure à un défaut matériel.`,
    };
  }

  return {
    tone: "warn",
    text: `Plusieurs boutons (${problematic.length}/${graded.length}) montrent un taux de chatter inhabituel: ${labels}. Si ça touche des boutons sans rapport mécanique entre eux, vérifie d'abord le navigateur, le pilote ou la connexion (filaire/sans-fil) avant de soupçonner un défaut matériel.`,
  };
}
