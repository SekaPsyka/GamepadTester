import { CHATTER_THRESHOLD_MS } from "./gamepad.js";

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
    this.finished = this.queue.length === 0;
  }

  get currentButton() {
    return this.queue[this.currentIdx] || null;
  }

  // À appeler à chaque frame avec le tableau pad.buttons et un timestamp (performance.now()).
  // Le chrono ne démarre qu'au premier appui détecté sur le bouton courant, pas dès l'affichage.
  feed(padButtons, now) {
    if (this.finished) return;

    const current = this.currentButton;
    const btn = padButtons[current.index];
    const pressed = btn ? btn.pressed || btn.value > 0.08 : false;

    if (pressed && !this.prevPressed) {
      if (this.windowStart == null) this.windowStart = now;
      this.pressCount++;
      if (this.lastReleaseTime != null && now - this.lastReleaseTime < CHATTER_THRESHOLD_MS) {
        this.chatterCount++;
      }
    }
    if (!pressed && this.prevPressed) {
      this.lastReleaseTime = now;
    }
    this.prevPressed = pressed;

    if (this.windowStart != null && now - this.windowStart >= this.durationMs) {
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
    });
  }

  _advance() {
    this.currentIdx++;
    this.pressCount = 0;
    this.chatterCount = 0;
    this.prevPressed = false;
    this.lastReleaseTime = null;
    this.windowStart = null;
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
