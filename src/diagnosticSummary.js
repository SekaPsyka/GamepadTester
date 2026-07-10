const RELIABILITY_ADJECTIVES = {
  excellent: "excellente",
  good: "bonne",
  fair: "moyenne",
  poor: "mauvaise",
  na: "non évaluée",
};

export function buildConnectionVerdict(gamepad) {
  if (!gamepad) {
    return {
      status: "neutral",
      label: "Non connecté",
      title: "Manette",
      text: "Aucune manette connectée. Connectez-en une avant de tirer une conclusion sur son état.",
    };
  }

  return {
    status: "ok",
    title: "Manette",
    text: `${gamepad.id} détectée, ${gamepad.buttonCount} boutons, ${gamepad.axisCount} axes.`,
  };
}

export function getDiagnosticSummaryState(items) {
  if (items.some((item) => item.status === "bad")) {
    return {
      status: "bad",
      label: "Problème probable",
      lead: "Au moins un résultat mérite une vérification matérielle ou un nouveau test.",
    };
  }
  if (items.some((item) => item.status === "warn")) {
    return {
      status: "warn",
      label: "Points à confirmer",
      lead: "Certaines mesures sont atypiques ou demandent une seconde tentative.",
    };
  }
  if (items.some((item) => item.status === "neutral")) {
    return {
      status: "neutral",
      label: "Diagnostic incomplet",
      lead: "Terminez les tests indiqués comme non réalisés avant de conclure.",
    };
  }
  return {
    status: "ok",
    label: "Mesures cohérentes",
    lead: "Aucun problème n'a été détecté dans les tests réalisés dans de bonnes conditions.",
  };
}

export function reliabilityAdjective(grade, { capitalized = false } = {}) {
  const adjective = RELIABILITY_ADJECTIVES[grade?.key] || String(grade?.label || "non évaluée").toLowerCase();
  return capitalized ? adjective.charAt(0).toUpperCase() + adjective.slice(1) : adjective;
}
