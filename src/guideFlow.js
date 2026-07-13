export const GUIDE_STEP_IDS = ["overview", "sticks", "triggers", "buttons", "summary"];

function task(id, label, state, detail = "") {
  return { id, label, state, detail };
}

function taskState({ complete = false, active = false, notApplicable = false } = {}) {
  if (notApplicable) return "not-applicable";
  if (complete) return "complete";
  if (active) return "active";
  return "pending";
}

function stepState(tasks, skipped) {
  if (tasks.length > 0 && tasks.every((item) => item.state === "complete" || item.state === "not-applicable")) return "complete";
  if (skipped) return "skipped";
  if (tasks.some((item) => item.state === "active" || item.state === "complete" || item.state === "error")) return "in-progress";
  return "not-started";
}

export function buildGuideFlow({
  connected = false,
  neutral = {},
  calibration = {},
  triggers = {},
  vibrationSupported = null,
  vibrationCommands = {},
  mashCompleted = false,
  skippedSteps = [],
} = {}) {
  const skipped = new Set(skippedSteps);
  const calibrationDetail = (state = {}) => state.complete
    ? "3 tours terminés"
    : state.active
      ? "Rotation en cours"
      : "3 tours guidés à 360°";
  const vibrationTask = (side, label) => {
    const commandState = vibrationCommands[side] || "pending";
    const state = vibrationSupported === false
      ? "not-applicable"
      : commandState === "complete"
        ? "complete"
        : commandState === "running"
          ? "active"
          : commandState === "error"
            ? "error"
            : "pending";
    const details = {
      pending: "À tester",
      running: "Commande en cours",
      complete: "Commande envoyée",
      error: "Échec de l'envoi",
    };
    return task(`vibration-${side}`, label, state, vibrationSupported === false ? "Non applicable" : details[commandState]);
  };

  const tasksByStep = {
    overview: [task("connection", "Manette détectée", taskState({ complete: connected }))],
    sticks: [
      task("neutral", "Point neutre des deux sticks", taskState({ complete: neutral.measured, active: neutral.active }), "Mesure de 3 s"),
      task("amplitude-left", "Amplitude du stick gauche", taskState(calibration.left), calibrationDetail(calibration.left)),
      task("amplitude-right", "Amplitude du stick droit", taskState(calibration.right), calibrationDetail(calibration.right)),
    ],
    triggers: [
      task("trigger-lt", "Stabilité de LT / L2", taskState(triggers.lt), triggers.lt?.detail || "Maintien à mi-course"),
      task("trigger-rt", "Stabilité de RT / R2", taskState(triggers.rt), triggers.rt?.detail || "Maintien à mi-course"),
      vibrationTask("strong", "Vibration du moteur gauche"),
      vibrationTask("weak", "Vibration du moteur droit"),
    ],
    buttons: [task("button-diagnostic", "Diagnostic répété des boutons", taskState({ complete: mashCompleted }), "Guide / PS exclu")],
    summary: [],
  };

  const steps = Object.fromEntries(GUIDE_STEP_IDS.map((id) => {
    const tasks = tasksByStep[id];
    const applicableTasks = tasks.filter((item) => item.state !== "not-applicable");
    return [id, {
      id,
      tasks,
      state: id === "summary" ? "not-started" : stepState(tasks, skipped.has(id)),
      completedCount: applicableTasks.filter((item) => item.state === "complete").length,
      totalCount: applicableTasks.length,
    }];
  }));

  return { steps, skippedSteps: [...skipped] };
}

export async function executeHapticCommand(playEffect) {
  try {
    const result = await playEffect();
    return result === "preempted"
      ? { status: "error", reason: "preempted" }
      : { status: "complete", reason: null };
  } catch {
    return { status: "error", reason: "rejected" };
  }
}
