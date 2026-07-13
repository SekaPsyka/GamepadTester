import test from "node:test";
import assert from "node:assert/strict";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { buildDiagnosticPdf } from "../src/diagnosticPdf.js";

function buildReport(overrides = {}) {
  return {
    generatedAt: "2026-07-13T18:30:00.000Z",
    gamepad: {
      id: "Xbox Wireless Controller - nom volontairement long pour vérifier la mise en page du rapport",
      index: 0,
      controllerType: "xbox",
      mapping: "standard",
      buttonCount: 17,
      axisCount: 4,
    },
    deadzones: { left: { inner: 0.08, outer: 0.96 }, right: { inner: 0.1, outer: 0.94 } },
    calibration: {
      left: { state: "symmetric", asymmetryPercent: 7, message: "Amplitude complète et régulière dans toutes les directions." },
      right: { state: "asymmetric", asymmetryPercent: 24, message: "Amplitude légèrement asymétrique dans la direction haute, à contrôler une seconde fois." },
    },
    neutralDrift: {
      left: { measured: true, x: 0.008, y: -0.011, magnitude: 0.014 },
      right: { measured: true, x: 0.052, y: -0.018, magnitude: 0.055 },
    },
    triggerStability: {
      lt: { measured: true, range: 0.018, stepCount: 0 },
      rt: { measured: true, range: 0.071, stepCount: 3 },
    },
    vibration: { supported: true, commands: { strong: "complete", weak: "complete" } },
    guide: { skippedSteps: [] },
    chatterEventsTotal: 4,
    totalPressCount: 601,
    chatterByButton: [
      { label: "A", pressCount: 120, count: 2 },
      { label: "RB", pressCount: 91, count: 1 },
      { label: "Y", pressCount: 102, count: 1 },
    ],
    mashTest: ["A", "B", "X", "Y", "LB", "RB"].map((label, index) => ({
      label,
      pressCount: 26 + index,
      pressesPerSecond: 4.8 + index * 0.2,
      chatterCount: index === 3 ? 2 : index === 1 ? 1 : 0,
      reliable: index !== 3,
      maxStallGapMs: index === 3 ? 142 : 22,
    })),
    ...overrides,
  };
}

function createPdf(report) {
  globalThis.localStorage = { getItem: () => "amber" };
  return buildDiagnosticPdf(report, jsPDF, autoTable);
}

test("le rapport représentatif répartit les détails sans page orpheline", () => {
  const doc = createPdf(buildReport());
  assert.equal(doc.getNumberOfPages(), 3);
  const finalPage = doc.internal.pages.at(-1).join("\n");
  assert.match(finalPage, /Doubles/);
  assert.match(finalPage, /DIAGNOSTIC/);
});

test("les contenus longs et une table complète restent paginés sans page orpheline", () => {
  const longLabels = Array.from({ length: 20 }, (_, index) => `Bouton de diagnostic numéro ${index + 1}`);
  const report = buildReport({
    gamepad: {
      ...buildReport().gamepad,
      id: "Contrôleur expérimental avec un identifiant matériel extrêmement long destiné à vérifier les retours à la ligne et les marges du document exporté",
    },
    chatterByButton: longLabels.map((label, index) => ({ label, pressCount: 40 + index, count: index % 3 })),
    mashTest: longLabels.map((label, index) => ({
      label,
      pressCount: 25 + index,
      pressesPerSecond: 4.2,
      chatterCount: index % 4 === 0 ? 1 : 0,
      reliable: index % 5 !== 0,
      maxStallGapMs: index % 5 === 0 ? 150 : 20,
    })),
  });
  const doc = createPdf(report);
  assert.ok(doc.getNumberOfPages() >= 2);
  assert.ok(doc.getNumberOfPages() <= 4);
});