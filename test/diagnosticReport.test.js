import test from "node:test";
import assert from "node:assert/strict";
import { buildDiagnosticReport, computeDiagnosticVerdict } from "../src/diagnosticReport.js";

function baseReport(overrides = {}) {
  return {
    guide: { skippedSteps: [] },
    gamepad: { id: "Pad", buttonCount: 17, axisCount: 4 },
    calibration: { left: null, right: null },
    neutralDrift: {
      left: { measured: false, magnitude: 0 },
      right: { measured: false, magnitude: 0 },
    },
    triggerStability: {
      lt: { measured: false },
      rt: { measured: false },
    },
    vibration: { supported: false, commands: {} },
    totalPressCount: 0,
    chatterEventsTotal: 0,
    chatterByButton: [],
    mashTest: null,
    ...overrides,
  };
}

test("le verdict utilise la mesure structurée plutôt que le texte affiché", () => {
  const report = baseReport({
    calibration: {
      left: { state: "asymmetric", asymmetryPercent: 42, message: "Formulation libre" },
      right: null,
    },
  });

  const sticks = computeDiagnosticVerdict(report).find((item) => item.title === "Sticks");
  assert.equal(sticks.status, "bad");
  assert.match(sticks.text, /42 %/);
});
test("un tracé symétrique reste cohérent même avec une asymétrie mesurée à zéro", () => {
  const report = baseReport({
    calibration: {
      left: { state: "symmetric", asymmetryPercent: 0, message: "Formulation libre" },
      right: null,
    },
  });

  const sticks = computeDiagnosticVerdict(report).find((item) => item.title === "Sticks");
  assert.equal(sticks.status, "ok");
});

test("un tracé incomplet ne produit pas de verdict positif", () => {
  const report = baseReport({
    calibration: {
      left: { state: "incomplete", asymmetryPercent: null },
      right: null,
    },
  });

  const sticks = computeDiagnosticVerdict(report).find((item) => item.title === "Sticks");
  assert.equal(sticks.status, "neutral");
});

test("la construction du rapport prend un instantané indépendant de la session", () => {
  const calibration = { left: { state: "symmetric", asymmetryPercent: 0 }, right: null };
  const report = buildDiagnosticReport({
    pad: null,
    deadzones: { left: { inner: 0.1, outer: 0.95 }, right: { inner: 0.1, outer: 0.95 } },
    calibration,
    neutralDrift: { left: { measured: false }, right: { measured: false } },
    triggerStability: { lt: { measured: false }, rt: { measured: false } },
    vibrationCommands: { strong: "pending", weak: "pending" },
    skippedSteps: new Set(),
    chatterTotal: 0,
    pressCountByButton: new Map(),
    chatterByButton: new Map(),
    mashResults: null,
    generatedAt: "2026-07-11T00:00:00.000Z",
  });

  calibration.left.asymmetryPercent = 99;
  assert.equal(report.calibration.left.asymmetryPercent, 0);
  assert.equal(report.generatedAt, "2026-07-11T00:00:00.000Z");
});
