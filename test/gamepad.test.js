import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDeadzone,
  detectControllerType,
  isButtonPressed,
  NeutralDriftTracker,
  TriggerStabilityTracker,
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
  for (let now = 0; now <= 5200; now += 20) tracker.update(0.5 + (now % 40 === 0 ? 0.001 : 0), now);
  assert.equal(tracker.getResult().measured, true);
  assert.equal(triggerStabilityGrade(tracker.getResult()).key, "excellent");
});
