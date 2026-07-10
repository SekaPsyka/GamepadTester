import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConnectionVerdict,
  getDiagnosticSummaryState,
  reliabilityAdjective,
} from "../src/diagnosticSummary.js";

test("une manette absente rend le diagnostic incomplet, pas alarmant", () => {
  const connection = buildConnectionVerdict(null);
  assert.equal(connection.status, "neutral");
  assert.equal(getDiagnosticSummaryState([connection]).label, "Diagnostic incomplet");
});

test("la synthèse conserve la priorité des résultats réellement problématiques", () => {
  assert.equal(getDiagnosticSummaryState([{ status: "neutral" }, { status: "warn" }]).status, "warn");
  assert.equal(getDiagnosticSummaryState([{ status: "warn" }, { status: "bad" }]).status, "bad");
  assert.equal(getDiagnosticSummaryState([{ status: "ok" }]).status, "ok");
});

test("accorde le niveau de fiabilité avec le nom féminin", () => {
  assert.equal(reliabilityAdjective({ key: "good", label: "Bon" }), "bonne");
  assert.equal(reliabilityAdjective({ key: "excellent", label: "Excellent" }, { capitalized: true }), "Excellente");
});
