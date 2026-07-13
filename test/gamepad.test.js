import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDeadzone,
  detectControllerType,
  isButtonPressed,
  isPassiveChatterButton,
  NeutralDriftTracker,
  TriggerStabilityTracker,
  TRIGGER_SETTLE_MS,
  triggerStabilityGrade,
} from "../src/gamepad.js";

test("détecte les familles de manettes prises en charge", () => {
  assert.equal(detectControllerType("Xbox Wireless Controller"), "xbox");
  assert.equal(detectControllerType("DualSense Wireless Controller"), "playstation");
  assert.equal(detectControllerType("USB Gamepad"), "generic");
});

test("applique la zone morte radiale et la saturation extérieure", () => {
  assert.deepEqual(applyDeadzone(0.05, 0, 0.1, 0.95), { x: 0, y: 0, magnitude: 0 });
  const saturated = applyDeadzone(1, 0, 0.1, 0.95);
  assert.equal(saturated.x, 1);
  assert.equal(saturated.magnitude, 1);
});

test("conserve l'hystérésis des gâchettes près du seuil", () => {
  const trigger = { pressed: false, value: 0.1 };
  assert.equal(isButtonPressed(trigger, 6, false), false);
  assert.equal(isButtonPressed(trigger, 6, true), true);
});

test("exclut les gâchettes analogiques du chatter passif", () => {
  assert.equal(isPassiveChatterButton(0), true);
  assert.equal(isPassiveChatterButton(6), false);
  assert.equal(isPassiveChatterButton(7), false);
});

test("mesure un point neutre stable et refuse un signal en mouvement", () => {
  const stable = new NeutralDriftTracker();
  for (let now = 0; now <= 1200; now += 20) stable.update(0.05, -0.02, now);
  assert.equal(stable.getOffset().measured, true);
  assert.ok(Math.abs(stable.getOffset().x - 0.05) < 1e-9);

  const moving = new NeutralDriftTracker();
  for (let now = 0; now <= 1200; now += 20) moving.update(now % 40 === 0 ? 0.08 : -0.08, 0, now);
  assert.equal(moving.getOffset().measured, false);
});

test("valide une gâchette tenue sur un signal régulier", () => {
  const tracker = new TriggerStabilityTracker();
  for (let now = 0; now <= 6200; now += 20) tracker.update(0.5 + (now % 40 === 0 ? 0.001 : 0), now);
  assert.equal(tracker.getResult().measured, true);
  assert.equal(triggerStabilityGrade(tracker.getResult()).key, "excellent");
});

test("attend un palier stable avant de démarrer les cinq secondes", () => {
  const tracker = new TriggerStabilityTracker();
  for (let now = 0; now <= 1200; now += 20) {
    tracker.update(0.15 + (now / 1200) * 0.35, now);
  }
  assert.equal(tracker.getStatus(1200).phase, "stabilizing");

  for (let now = 1220; now <= 2200; now += 20) tracker.update(0.5, now);
  assert.equal(tracker.getStatus(2200).phase, "measuring");
});

test("n'inclut pas la mise en position dans le résultat de stabilité", () => {
  const tracker = new TriggerStabilityTracker();
  for (let now = 0; now <= 1000; now += 20) {
    tracker.update(0.15 + (now / 1000) * 0.35, now);
  }
  for (let now = 1020; now <= 7200; now += 20) {
    tracker.update(0.5 + (now % 40 === 0 ? 0.001 : -0.001), now);
  }

  const result = tracker.getResult();
  assert.equal(result.measured, true);
  assert.ok(result.range <= 0.0021);
});

test("relance explicitement la stabilisation si le doigt dérive pendant la mesure", () => {
  const tracker = new TriggerStabilityTracker();
  for (let now = 0; now <= TRIGGER_SETTLE_MS; now += 20) tracker.update(0.4, now);
  assert.equal(tracker.getStatus(TRIGGER_SETTLE_MS).phase, "measuring");

  for (let now = TRIGGER_SETTLE_MS + 20; now <= TRIGGER_SETTLE_MS + 5200; now += 20) {
    const progress = (now - TRIGGER_SETTLE_MS) / 5000;
    tracker.update(0.4 + Math.min(1, progress) * 0.1, now);
  }

  const status = tracker.getStatus(TRIGGER_SETTLE_MS + 5200);
  assert.equal(tracker.getResult().measured, false);
  assert.equal(status.phase, "stabilizing");
  assert.equal(status.notice, "moved");
});
