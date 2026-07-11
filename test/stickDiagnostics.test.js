import test from "node:test";
import assert from "node:assert/strict";
import { analyzeStickRange } from "../src/stickDiagnostics.js";

function circlePoints(radiusForSector = () => 1) {
  return Array.from({ length: 16 }, (_, sector) => {
    const angle = ((sector + 0.5) / 16) * Math.PI * 2;
    const radius = radiusForSector(sector);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

test("retourne un résultat structuré pour un tracé symétrique", () => {
  const result = analyzeStickRange(circlePoints());
  assert.equal(result.state, "symmetric");
  assert.equal(result.measured, true);
  assert.equal(result.asymmetryPercent, 0);
});

test("conserve la mesure d'asymétrie indépendamment de sa formulation", () => {
  const result = analyzeStickRange(circlePoints((sector) => (sector === 0 ? 0.5 : 1)));
  assert.equal(result.state, "asymmetric");
  assert.equal(result.asymmetryPercent, 50);
  assert.equal(result.angleDeg, 0);
});

test("distingue un tracé incomplet d'une absence de mesure", () => {
  const result = analyzeStickRange(circlePoints().slice(0, 8));
  assert.equal(result.state, "incomplete");
  assert.equal(result.measured, true);
  assert.equal(result.asymmetryPercent, null);
});
