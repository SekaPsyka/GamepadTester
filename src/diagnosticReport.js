import {
  detectControllerType,
  NEUTRAL_DRIFT_WARN_THRESHOLD,
  NEUTRAL_DRIFT_BAD_THRESHOLD,
  triggerStabilityGrade,
} from "./gamepad.js";
import { chatterRate, gradeForChatter } from "./mashTest.js";
import { buildConnectionVerdict, reliabilityAdjective } from "./diagnosticSummary.js";

export const GRADE_STATUS = { excellent: "ok", good: "ok", fair: "warn", poor: "bad", na: "neutral" };

const GUIDE_STEP_LABELS = {
  overview: "Connexion",
  sticks: "Sticks",
  triggers: "Gâchettes",
  buttons: "Boutons",
  summary: "Résultats",
};

export function buildDiagnosticReport({
  pad = null,
  deadzones,
  calibration,
  neutralDrift,
  triggerStability,
  vibrationCommands,
  skippedSteps,
  chatterTotal,
  pressCountByButton,
  chatterByButton,
  mashResults,
  generatedAt = new Date().toISOString(),
}) {
  return {
    generatedAt,
    gamepad: pad
      ? {
          id: pad.id,
          index: pad.index,
          controllerType: detectControllerType(pad.id),
          mapping: pad.mapping || "non standard",
          buttonCount: pad.buttons.length,
          axisCount: pad.axes.length,
        }
      : null,
    deadzones,
    calibration: {
      left: calibration.left ? { ...calibration.left } : null,
      right: calibration.right ? { ...calibration.right } : null,
    },
    neutralDrift: {
      left: { ...neutralDrift.left },
      right: { ...neutralDrift.right },
    },
    triggerStability: {
      lt: { ...triggerStability.lt },
      rt: { ...triggerStability.rt },
    },
    vibration: {
      supported: Boolean(pad?.vibrationActuator),
      commands: { ...vibrationCommands },
    },
    guide: { skippedSteps: [...skippedSteps] },
    chatterEventsTotal: chatterTotal,
    totalPressCount: [...pressCountByButton.values()].reduce((sum, count) => sum + count, 0),
    chatterByButton: [...chatterByButton.entries()]
      .map(([label, count]) => ({ label, count, pressCount: pressCountByButton.get(label) || count }))
      .sort((first, second) => second.count - first.count),
    mashTest: mashResults
      ? mashResults.map((result) => ({
          label: result.label,
          pressCount: result.pressCount,
          pressesPerSecond: Number(result.pressesPerSecond.toFixed(1)),
          chatterCount: result.chatterCount,
          reliable: result.reliable,
          maxStallGapMs: result.maxStallGapMs,
        }))
      : null,
  };
}

// Environ le double du seuil de détection de 18 % : on réserve le niveau
// problématique aux asymétries franchement au-dessus du bruit de mesure.
const ASYMMETRY_BAD_THRESHOLD_PERCENT = 35;
export function computeDiagnosticVerdict(report) {
  const items = [];

  if (report.guide?.skippedSteps?.length) {
    const labels = report.guide.skippedSteps.map((id) => GUIDE_STEP_LABELS[id] || id);
    items.push({
      status: "neutral",
      title: "Étapes passées",
      text: `${labels.join(", ")} : ces étapes ont été passées volontairement et restent non testées dans cette synthèse.`,
    });
  }

  items.push(buildConnectionVerdict(report.gamepad));

  const leftPercent = report.calibration.left?.state === "asymmetric" ? report.calibration.left.asymmetryPercent : null;
  const rightPercent = report.calibration.right?.state === "asymmetric" ? report.calibration.right.asymmetryPercent : null;
  const hasIncompleteCalibration = [report.calibration.left, report.calibration.right]
    .some((result) => result?.state === "incomplete");
  if (!report.calibration.left && !report.calibration.right) {
    items.push({ status: "neutral", title: "Sticks", text: "Aucun test d'amplitude effectué. La couverture et l'asymétrie des sticks ne sont pas encore vérifiées." });
  } else if (leftPercent != null || rightPercent != null) {
    const sides = [leftPercent != null ? "gauche" : null, rightPercent != null ? "droit" : null].filter(Boolean).join(" et ");
    const worstPercent = Math.max(leftPercent ?? 0, rightPercent ?? 0);
    const status = worstPercent >= ASYMMETRY_BAD_THRESHOLD_PERCENT ? "bad" : "warn";
    const severity = status === "bad" ? "marquée" : "modérée";
    items.push({
      status,
      title: "Sticks",
      text: `Asymétrie ${severity} observée sur le stick ${sides} (${worstPercent} %). Recommencez le test pour vérifier que le résultat est reproductible.`,
    });
  } else if (hasIncompleteCalibration) {
    items.push({ status: "neutral", title: "Sticks", text: "Au moins un tracé d'amplitude est incomplet. Recommencez le tour à 360° avant de conclure." });
  } else {    items.push({ status: "ok", title: "Sticks", text: "Aucune asymétrie notable observée pendant les tests d'amplitude réalisés." });
  }

  const { left: leftNeutral, right: rightNeutral } = report.neutralDrift;
  if (!leftNeutral.measured && !rightNeutral.measured) {
    items.push({ status: "neutral", title: "Point neutre des sticks", text: "Pas encore mesuré, laissez les sticks au repos quelques secondes sans y toucher." });
  } else {
    const driftedSides = [
      leftNeutral.measured && leftNeutral.magnitude > NEUTRAL_DRIFT_WARN_THRESHOLD ? "gauche" : null,
      rightNeutral.measured && rightNeutral.magnitude > NEUTRAL_DRIFT_WARN_THRESHOLD ? "droit" : null,
    ].filter(Boolean);
    if (driftedSides.length === 0) {
      items.push({ status: "ok", title: "Point neutre des sticks", text: "Aucun décalage notable du point de repos détecté." });
    } else {
      const worstMagnitude = Math.max(
        leftNeutral.measured ? leftNeutral.magnitude : 0,
        rightNeutral.measured ? rightNeutral.magnitude : 0
      );
      const status = worstMagnitude > NEUTRAL_DRIFT_BAD_THRESHOLD ? "bad" : "warn";
      const magnitudePercent = Math.round(worstMagnitude * 100);
      items.push({
        status,
        title: "Point neutre des sticks",
        text:
          status === "bad"
            ? `Décalage net du point de repos détecté sur le stick ${driftedSides.join(" et ")} (${magnitudePercent}% de l'amplitude), au-delà de la zone morte habituelle : signe probable d'un drift actif.`
            : `Décalage du point de repos détecté sur le stick ${driftedSides.join(" et ")} (${magnitudePercent}% de l'amplitude), à confirmer avec une seconde mesure même si le test d'amplitude ne montre pas d'asymétrie.`,
      });
    }
  }

  const { lt: ltStability, rt: rtStability } = report.triggerStability;
  if (!ltStability.measured && !rtStability.measured) {
    items.push({ status: "neutral", title: "Gâchettes", text: "Stabilité pas encore mesurée, maintenez chaque gâchette à mi-course quelques secondes." });
  } else {
    const ltGrade = triggerStabilityGrade(ltStability);
    const rtGrade = triggerStabilityGrade(rtStability);
    const unstableSides = [
      ltGrade.key !== "na" && ltGrade.key !== "excellent" ? "LT" : null,
      rtGrade.key !== "na" && rtGrade.key !== "excellent" ? "RT" : null,
    ].filter(Boolean);
    if (unstableSides.length === 0) {
      items.push({ status: "ok", title: "Gâchettes", text: "Signal régulier pendant le maintien manuel des gâchettes. La mesure reste dépendante de la stabilité du geste." });
    } else {
      const worstGrade = [ltGrade, rtGrade].some((g) => g.key === "poor") ? "poor" : "fair";
      const anyIsolated = (ltGrade.isolated || rtGrade.isolated) && worstGrade !== "poor";
      const worstRange = Math.max(
        ltStability.measured ? ltStability.range : 0,
        rtStability.measured ? rtStability.range : 0
      );
      const status = worstGrade === "poor" ? "bad" : "warn";
      const rangePercent = Math.round(worstRange * 100);
      items.push({
        status,
        title: "Gâchettes",
        text:
          worstGrade === "poor"
            ? `Signal instable détecté sur ${unstableSides.join(" et ")} (écart de ${rangePercent}% à palier tenu, sauts répétés). Recommencez le test avant de suspecter un défaut du capteur.`
            : anyIsolated
              ? `Écart isolé détecté sur ${unstableSides.join(" et ")} (écart de ${rangePercent}% à palier tenu, saut unique): probablement un accident de mesure ponctuel plutôt qu'un vrai défaut, retestez pour confirmer.`
              : `Léger bruit détecté sur ${unstableSides.join(" et ")} (écart de ${rangePercent}% à palier tenu), à surveiller mais pas encore franchement anormal.`,
      });
    }
  }

  const vibration = report.vibration || { supported: false, commands: {} };
  if (!vibration.supported) {
    items.push({
      status: "ok",
      label: "Non applicable",
      title: "Vibrations",
      text: "La commande de vibration n'est pas exposée par cette manette ou ce navigateur ; cette vérification ne bloque pas le diagnostic.",
    });
  } else if (vibration.commands.strong !== "complete" || vibration.commands.weak !== "complete") {
    const failed = [vibration.commands.strong, vibration.commands.weak].includes("error");
    items.push({
      status: "neutral",
      title: "Vibrations",
      text: failed
        ? "Au moins une commande de vibration a échoué ou été interrompue. Réessayez en gardant l'onglet visible."
        : "Les commandes de vibration n'ont pas encore été envoyées aux deux moteurs.",
    });
  } else {
    items.push({
      status: "ok",
      label: "Commandes envoyées",
      title: "Vibrations",
      text: "Les commandes à 100 % pendant 600 ms ont été envoyées aux deux moteurs. L'application ne peut pas confirmer la force réellement produite.",
    });
  }

  if (report.totalPressCount < 20) {
    items.push({ status: "neutral", title: "Doubles déclenchements", text: "Pas assez d'appuis observés pour conclure. Lancez le diagnostic des boutons." });
  } else if (report.chatterEventsTotal === 0) {
    items.push({ status: "ok", title: "Observation libre des boutons", text: "Aucun double déclenchement involontaire observé pendant les appuis libres." });
  } else {
    // Comme pour le mashing: un chatter isolé sur des centaines d'appuis en usage normal
    // n'a rien à voir avec un chatter récurrent. On juge sur le taux global plutôt que sur
    // le compte brut, avec le même barème que le diagnostic des boutons pour rester cohérent.
    const worst = report.chatterByButton[0];
    const rate = worst ? Math.round((worst.count / worst.pressCount) * 100) : 0;
    const detail = worst ? ` Bouton le plus touché: ${worst.label} (${worst.count} fois sur ${worst.pressCount} appuis, soit ${rate}%).` : "";
    const grade = gradeForChatter(report.chatterEventsTotal, report.totalPressCount);
    const globalRate = Math.round(chatterRate(report.chatterEventsTotal, report.totalPressCount) * 100);
    let text;
    if (grade.key === "na") {
      text = `${report.chatterEventsTotal} événement(s) détecté(s), pas assez d'appuis en usage normal pour juger du taux réel, à confirmer avec le diagnostic des boutons.${detail}`;
    } else {
      text = `${report.chatterEventsTotal} événement(s) détecté(s) sur ${report.totalPressCount} appuis (${globalRate}%), fiabilité ${reliabilityAdjective(grade)}.${detail}`;
    }
    items.push({ status: GRADE_STATUS[grade.key], title: "Observation libre des boutons", text });
  }

  if (!report.mashTest) {
    items.push({
      status: "neutral",
      title: "Diagnostic des boutons",
      text: "Aucun test guidé effectué. Lancez le diagnostic des boutons pour vérifier les doubles déclenchements bouton par bouton.",
    });
  } else {
    const totalPressCount = report.mashTest.reduce((sum, r) => sum + r.pressCount, 0);
    const totalChatter = report.mashTest.reduce((sum, r) => sum + r.chatterCount, 0);
    const grade = gradeForChatter(totalChatter, totalPressCount);

    let text;
    if (grade.key === "na") {
      text = "Pas assez d'appuis enregistrés pendant le diagnostic pour conclure sur la fiabilité des boutons.";
    } else if (totalChatter === 0) {
      text = `Test effectué sur ${report.mashTest.length} bouton(s), aucun double déclenchement observé, fiabilité ${reliabilityAdjective(grade)}.`;
    } else {
      const worst = [...report.mashTest].sort((a, b) => b.chatterCount - a.chatterCount)[0];
      text = `Fiabilité ${reliabilityAdjective(grade)} (${totalChatter} double(s) déclenchement(s) sur ${totalPressCount} appuis). Bouton le plus touché : ${worst.label} (${worst.chatterCount} fois).`;
    }
    items.push({ status: GRADE_STATUS[grade.key], title: "Diagnostic des boutons", text });
  }

  return items;
}
