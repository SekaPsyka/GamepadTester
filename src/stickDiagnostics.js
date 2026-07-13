export const STICK_COVERAGE_SECTOR_COUNT = 16;
export const STICK_COVERAGE_MIN_RADIUS = 0.35;
export const STICK_REQUIRED_TURNS = 3;
const MAX_ANGULAR_STEP = Math.PI / 2;
const TURN_COMPLETION_TOLERANCE = 1 / STICK_COVERAGE_SECTOR_COUNT;

export function measureStickCoverage(
  points,
  {
    sectorCount = STICK_COVERAGE_SECTOR_COUNT,
    minRadius = STICK_COVERAGE_MIN_RADIUS,
    requiredTurns = STICK_REQUIRED_TURNS,
  } = {},
) {
  const sectorMax = new Array(sectorCount).fill(0);
  let previousAngle = null;
  let signedAngularTravel = 0;

  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    const radius = Math.hypot(point.x, point.y);
    if (radius < minRadius) {
      previousAngle = null;
      continue;
    }
    const angle = Math.atan2(point.y, point.x);
    const normalized = ((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
    const sector = Math.min(sectorCount - 1, Math.floor(normalized * sectorCount));
    if (radius > sectorMax[sector]) sectorMax[sector] = radius;

    if (previousAngle !== null) {
      let delta = angle - previousAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) <= MAX_ANGULAR_STEP) signedAngularTravel += delta;
    }
    previousAngle = angle;
  }

  const sectors = sectorMax.map((radius) => radius >= minRadius);
  const coveredCount = sectors.filter(Boolean).length;
  const turns = Math.abs(signedAngularTravel) / (Math.PI * 2);
  const completedTurns = Math.min(requiredTurns, Math.floor(turns + TURN_COMPLETION_TOLERANCE));
  const directionsComplete = coveredCount === sectorCount;
  const complete = directionsComplete && turns >= requiredTurns - TURN_COMPLETION_TOLERANCE;
  return {
    sectorCount,
    coveredCount,
    coveragePercent: Math.round((coveredCount / sectorCount) * 100),
    requiredTurns,
    turns,
    completedTurns,
    rotationProgressPercent: complete ? 100 : Math.min(99, Math.round((turns / requiredTurns) * 100)),
    directionsComplete,
    complete,
    sectors,
    sectorMax,
  };
}

export function analyzeStickRange(points) {
  if (points.length < 5) {
    return {
      state: "insufficient",
      measured: false,
      asymmetryPercent: null,
      roundnessPercent: null,
      angleDeg: null,
      message: "Pas assez de données, réessayez.",
    };
  }

  const sectorMax = new Array(STICK_COVERAGE_SECTOR_COUNT).fill(0);
  for (const point of points) {
    const angle = Math.atan2(point.y, point.x);
    const normalized = ((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
    const sector = Math.min(STICK_COVERAGE_SECTOR_COUNT - 1, Math.floor(normalized * STICK_COVERAGE_SECTOR_COUNT));
    const radius = Math.hypot(point.x, point.y);
    if (radius > sectorMax[sector]) sectorMax[sector] = radius;
  }

  const filledRadii = sectorMax.filter((radius) => radius > 0);
  if (filledRadii.length < STICK_COVERAGE_SECTOR_COUNT * 0.75) {
    return {
      state: "incomplete",
      measured: true,
      asymmetryPercent: null,
      roundnessPercent: null,
      angleDeg: null,
      message: "Tracé incomplet, faites un tour à 360° plus régulier pour une analyse fiable.",
    };
  }

  let maxAsymmetry = 0;
  let worstSector = 0;
  for (let sector = 0; sector < STICK_COVERAGE_SECTOR_COUNT / 2; sector++) {
    const opposite = sector + STICK_COVERAGE_SECTOR_COUNT / 2;
    const firstRadius = sectorMax[sector];
    const oppositeRadius = sectorMax[opposite];
    if (firstRadius === 0 || oppositeRadius === 0) continue;
    const asymmetry = Math.abs(firstRadius - oppositeRadius) / Math.max(firstRadius, oppositeRadius);
    if (asymmetry > maxAsymmetry) {
      maxAsymmetry = asymmetry;
      worstSector = sector;
    }
  }

  const roundnessPercent = (Math.min(...filledRadii) / Math.max(...sectorMax)) * 100;
  if (maxAsymmetry < 0.18) {
    return {
      state: "symmetric",
      measured: true,
      asymmetryPercent: Math.round(maxAsymmetry * 100),
      roundnessPercent: Math.round(roundnessPercent),
      angleDeg: null,
      message: `Forme symétrique (rondeur globale: ${roundnessPercent.toFixed(0)}%), une forme carrée/octogonale est normale sur de nombreux sticks (guide mécanique), aucune anomalie détectée ✓`,
    };
  }

  const asymmetryPercent = Math.round(maxAsymmetry * 100);
  const angleDeg = Math.round((worstSector / STICK_COVERAGE_SECTOR_COUNT) * 360);
  return {
    state: "asymmetric",
    measured: true,
    asymmetryPercent,
    roundnessPercent: Math.round(roundnessPercent),
    angleDeg,
    message: `Asymétrie détectée (${asymmetryPercent}%) autour de ${angleDeg}°, une direction atteint un rayon nettement plus court que son opposée, ce qui peut indiquer une usure ou un stick drift localisé plutôt qu'un simple guide carré.`,
  };
}
