import test from "node:test";
import assert from "node:assert/strict";
import { buildGuideFlow, executeHapticCommand } from "../src/guideFlow.js";

test("le parcours distingue les étapes non commencées, en cours et terminées", () => {
  const initial = buildGuideFlow({ connected: true });
  assert.equal(initial.steps.overview.state, "complete");
  assert.equal(initial.steps.sticks.state, "not-started");

  const active = buildGuideFlow({ connected: true, neutral: { active: true } });
  assert.equal(active.steps.sticks.state, "in-progress");

  const complete = buildGuideFlow({
    connected: true,
    neutral: { measured: true },
    calibration: { left: { complete: true }, right: { complete: true } },
  });
  assert.equal(complete.steps.sticks.state, "complete");
  assert.equal(complete.steps.sticks.completedCount, 3);
  assert.equal(complete.steps.sticks.tasks[1].detail, "3 tours terminés");
});

test("décrit la progression de rotation dans la liste des tâches", () => {
  const flow = buildGuideFlow({ calibration: { left: { active: true } } });
  assert.equal(flow.steps.sticks.tasks[1].detail, "Rotation en cours");
  assert.equal(flow.steps.sticks.tasks[2].detail, "3 tours guidés à 360°");
});

test("une mesure atypique reste une mesure terminée", () => {
  const flow = buildGuideFlow({
    neutral: { measured: true },
    calibration: {
      left: { complete: true, outcome: "warn" },
      right: { complete: true, outcome: "bad" },
    },
  });
  assert.equal(flow.steps.sticks.state, "complete");
});

test("une étape passée est conservée explicitement", () => {
  const flow = buildGuideFlow({ skippedSteps: ["buttons"] });
  assert.equal(flow.steps.buttons.state, "skipped");
  assert.deepEqual(flow.skippedSteps, ["buttons"]);
});

test("une vibration non prise en charge ne bloque pas les gâchettes", () => {
  const untouched = buildGuideFlow({ vibrationSupported: false });
  assert.equal(untouched.steps.triggers.state, "not-started");
  assert.equal(untouched.steps.triggers.totalCount, 2);

  const flow = buildGuideFlow({
    triggers: { lt: { complete: true }, rt: { complete: true } },
    vibrationSupported: false,
  });
  assert.equal(flow.steps.triggers.state, "complete");
  assert.equal(flow.steps.triggers.tasks[2].state, "not-applicable");
});

test("les deux commandes de vibration sont requises quand elles sont disponibles", () => {
  const partial = buildGuideFlow({
    triggers: { lt: { complete: true }, rt: { complete: true } },
    vibrationSupported: true,
    vibrationCommands: { strong: "complete", weak: "pending" },
  });
  assert.equal(partial.steps.triggers.state, "in-progress");

  const complete = buildGuideFlow({
    triggers: { lt: { complete: true }, rt: { complete: true } },
    vibrationSupported: true,
    vibrationCommands: { strong: "complete", weak: "complete" },
  });
  assert.equal(complete.steps.triggers.state, "complete");
});

test("une commande haptique en cours ou en échec garde l'étape active", () => {
  const running = buildGuideFlow({ vibrationSupported: true, vibrationCommands: { strong: "running" } });
  assert.equal(running.steps.triggers.tasks[2].state, "active");

  const failed = buildGuideFlow({ vibrationSupported: true, vibrationCommands: { strong: "error" } });
  assert.equal(failed.steps.triggers.tasks[2].state, "error");
  assert.equal(failed.steps.triggers.state, "in-progress");
});

test("normalise les résultats complete, preempted et rejetés de l'API haptique", async () => {
  assert.deepEqual(await executeHapticCommand(async () => "complete"), { status: "complete", reason: null });
  assert.deepEqual(await executeHapticCommand(async () => undefined), { status: "complete", reason: null });
  assert.deepEqual(await executeHapticCommand(async () => "preempted"), { status: "error", reason: "preempted" });
  assert.deepEqual(await executeHapticCommand(async () => { throw new Error("refus"); }), { status: "error", reason: "rejected" });
});
