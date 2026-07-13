import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeStickRange,
  measureStickCoverage,
  STICK_COVERAGE_SECTOR_COUNT,
  STICK_REQUIRED_TURNS,
} from "../src/stickDiagnostics.js";

function circlePoints(radiusForSector = () => 1) {
  return Array.from({ length: 16 }, (_, sector) => {
    const angle = ((sector + 0.5) / 16) * Math.PI * 2;
    const radius = radiusForSector(sector);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function rotationPoints(turns, radius = 1) {
  const samplesPerTurn = STICK_COVERAGE_SECTOR_COUNT * 4;
  return Array.from({ length: samplesPerTurn * turns + 1 }, (_, index) => {
    const angle = (index / samplesPerTurn) * Math.PI * 2;
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

test("mesure les directions couvertes pendant la rotation", () => {
  const partial = measureStickCoverage(circlePoints().slice(0, 6));
  assert.equal(partial.coveredCount, 6);
  assert.equal(partial.complete, false);

  const oneTurn = measureStickCoverage(rotationPoints(1));
  assert.equal(oneTurn.coveredCount, STICK_COVERAGE_SECTOR_COUNT);
  assert.equal(oneTurn.directionsComplete, true);
  assert.equal(oneTurn.completedTurns, 1);
  assert.equal(oneTurn.complete, false);

  const complete = measureStickCoverage(rotationPoints(STICK_REQUIRED_TURNS));
  assert.equal(complete.completedTurns, STICK_REQUIRED_TURNS);
  assert.equal(complete.rotationProgressPercent, 100);
  assert.equal(complete.complete, true);
});

test("ignore les petits mouvements autour du point neutre", () => {
  const centerNoise = circlePoints(() => 0.2);
  const coverage = measureStickCoverage(centerNoise);
  assert.equal(coverage.coveredCount, 0);
  assert.equal(coverage.complete, false);
});

test("ne compte pas les changements de sens comme des tours supplémentaires", () => {
  const clockwise = rotationPoints(1);
  const counterClockwise = rotationPoints(1).reverse();
  const coverage = measureStickCoverage([...clockwise, ...counterClockwise]);
  assert.equal(coverage.completedTurns, 0);
  assert.equal(coverage.complete, false);
});

test("tolère la perte d'échantillonnage d'un secteur en fin de troisième tour", () => {
  const almostComplete = measureStickCoverage(rotationPoints(2.97));
  assert.equal(almostComplete.completedTurns, STICK_REQUIRED_TURNS);
  assert.equal(almostComplete.rotationProgressPercent, 100);
  assert.equal(almostComplete.complete, true);

  const tooShort = measureStickCoverage(rotationPoints(2.8));
  assert.equal(tooShort.completedTurns, 2);
  assert.equal(tooShort.complete, false);
});
