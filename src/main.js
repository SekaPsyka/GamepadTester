import "./style.css";
import { APP_MARKUP } from "./appMarkup.js";
import {
  applyDeadzone,
  detectControllerType,
  getConnectedGamepads,
  getLabelsFor,
  CHATTER_THRESHOLD_MS,
  NEUTRAL_DRIFT_WARN_THRESHOLD,
  isButtonPressed,
  TRIGGER_REQUIRED_HOLD_MS,
  triggerStabilityGrade,
} from "./gamepad.js";
import { getTheme, setTheme } from "./storage.js";
import { THEMES, applyTheme } from "./themes.js";
import { MashSequenceTest, buildMashQueue, gradeForChatter, buildMashVerdict } from "./mashTest.js";
import { createSilhouette, setSilhouetteType, updateSilhouette } from "./controllerSilhouette.js";
import { buildGuideFlow, executeHapticCommand } from "./guideFlow.js";
import { DiagnosticSession } from "./diagnosticSession.js";
import { analyzeStickRange } from "./stickDiagnostics.js";
import {
  buildDiagnosticReport as createDiagnosticReport,
  computeDiagnosticVerdict,
} from "./diagnosticReport.js";
import { buildDiagnosticPdf, slugify } from "./diagnosticPdf.js";
import {
  getDiagnosticSummaryState,
  reliabilityAdjective,
} from "./diagnosticSummary.js";

const app = document.getElementById("app");

app.innerHTML = APP_MARKUP;

const dot = document.getElementById("dot");
const padName = document.getElementById("padName");
const emptyState = document.getElementById("emptyState");
const grid = document.getElementById("grid");
const guideShell = document.getElementById("guideShell");
const guideKicker = document.getElementById("guideKicker");
const guideTitle = document.getElementById("guideTitle");
const guideDescription = document.getElementById("guideDescription");
const guideProgressLabel = document.getElementById("guideProgressLabel");
const guideNowTitle = document.getElementById("guideNowTitle");
const guideNowDescription = document.getElementById("guideNowDescription");
const guideTaskList = document.getElementById("guideTaskList");
const guideLiveStatus = document.getElementById("guideLiveStatus");
const guidePrevBtn = document.getElementById("guidePrevBtn");
const guideNextBtn = document.getElementById("guideNextBtn");
const guideSkipBtn = document.getElementById("guideSkipBtn");
const guideContextAction = document.getElementById("guideContextAction");
const guideStepButtons = [...document.querySelectorAll("[data-guide-target]")];
const modeButtons = [...document.querySelectorAll("[data-app-mode]")];
const labNavButtons = [...document.querySelectorAll("[data-lab-target]")];
const guideSections = [...document.querySelectorAll("[data-guide-section]")];
const exportReportBtn = document.getElementById("exportReportBtn");
const exportReportStatus = document.getElementById("exportReportStatus");
const openMashTestBtn = document.getElementById("openMashTestBtn");

const GUIDE_STEPS = [
  {
    id: "overview",
    label: "Connexion",
    title: "Manette détectée automatiquement",
    description: "Le navigateur affiche l'identité, le mapping et les capacités réellement exposées par la manette.",
  },
  {
    id: "sticks",
    label: "Sticks",
    title: "Mesurez le point neutre et l'amplitude",
    description: "Posez d'abord la manette sans toucher aux sticks, puis effectuez les rotations demandées pour distinguer décalage et amplitude incomplète.",
  },
  {
    id: "triggers",
    label: "Gâchettes",
    title: "Contrôlez les gâchettes et les vibrations",
    description: "Maintenez chaque gâchette à mi-course pendant cinq secondes, puis vérifiez séparément les deux moteurs de vibration.",
  },
  {
    id: "buttons",
    label: "Boutons",
    title: "Recherchez les doubles déclenchements",
    description: "Le test guidé exige un nombre minimal d'appuis et invalide les mesures perturbées par un ralentissement du navigateur.",
  },
  {
    id: "summary",
    label: "Résultats",
    title: "Lisez les résultats avec leur niveau de confiance",
    description: "Un test non réalisé reste indiqué comme tel : l'application ne conclut jamais à un bon état à partir de données manquantes.",
  },
];

let appMode = "guided";
let guideStepIndex = 0;
let isPadConnected = null;
let guideContextHandler = null;
let lastGuideAnnouncement = "";
let pdfExportInProgress = false;
const diagnosticSession = new DiagnosticSession();
const {
  calibration,
  neutralDrift,
  triggerStability,
  vibrationCommands,
  skippedGuideSteps,
  chatterByButton,
  pressCountByButton,
} = diagnosticSession;

const TASK_STATE_LABELS = {
  pending: "À faire",
  active: "En cours",
  complete: "Terminée",
  error: "Échec",
  "not-applicable": "Non applicable",
};

const STEP_STATE_LABELS = {
  "not-started": "Non commencé",
  "in-progress": "En cours",
  complete: "Terminé",
  skipped: "Passé",
};

function getGuideFlow() {
  const pad = getSelectedGamepad();
  const leftNeutral = neutralDrift.left.getOffset();
  const rightNeutral = neutralDrift.right.getOffset();
  return buildGuideFlow({
    connected: Boolean(isPadConnected),
    neutral: {
      measured: leftNeutral.measured && rightNeutral.measured,
      active: Boolean(diagnosticSession.neutralCapture),
    },
    calibration: {
      left: { complete: calibration.left.completed, active: calibration.left.active },
      right: { complete: calibration.right.completed, active: calibration.right.active },
    },
    triggers: {
      lt: { complete: triggerStability.lt.getResult().measured, active: triggerStability.lt.isAttempting() },
      rt: { complete: triggerStability.rt.getResult().measured, active: triggerStability.rt.isAttempting() },
    },
    vibrationSupported: pad ? Boolean(pad.vibrationActuator) : null,
    vibrationCommands,
    mashCompleted: Boolean(diagnosticSession.mashResults),
    skippedSteps: [...skippedGuideSteps],
  });
}

function taskInstruction(stepId, taskId) {
  const instructions = {
    connection: ["Manette détectée automatiquement", "Le nom, le nombre de boutons et le nombre d'axes exposés par le navigateur sont affichés ci-dessous."],
    neutral: ["Posez la manette et ne la touchez plus", "Démarrez la mesure de trois secondes lorsque les deux sticks sont complètement relâchés."],
    "amplitude-left": ["Testez l'amplitude du stick gauche", "Démarrez l'enregistrement, faites un tour complet et régulier, puis arrêtez pour analyser le tracé."],
    "amplitude-right": ["Testez l'amplitude du stick droit", "Démarrez l'enregistrement, faites un tour complet et régulier, puis arrêtez pour analyser le tracé."],
    "trigger-lt": ["Maintenez LT / L2 à mi-course", "Gardez la gâchette aussi stable que possible pendant cinq secondes. La mesure démarre automatiquement."],
    "trigger-rt": ["Maintenez RT / R2 à mi-course", "Gardez la gâchette aussi stable que possible pendant cinq secondes. La mesure démarre automatiquement."],
    "vibration-strong": ["Testez le moteur gauche", "L'application enverra une commande à 100 % pendant 600 ms, puis passera automatiquement au moteur droit."],
    "vibration-weak": ["Testez le moteur droit", "L'application enverra une commande à 100 % pendant 600 ms, puis terminera cette étape."],
    "button-diagnostic": ["Préparez le diagnostic des boutons", "Consultez d'abord les consignes et la durée estimée. Le test ne démarrera qu'après votre confirmation."],
  };
  if (stepId === "summary") return ["Consultez les résultats", "Chaque test manquant, passé ou à confirmer reste clairement signalé avant l'export."];
  return instructions[taskId] || ["Étape terminée", "Toutes les vérifications prévues pour cette étape ont été enregistrées."];
}

function getGuideAction(stepId, nextTask) {
  if (stepId === "sticks") {
    if (nextTask?.id === "neutral") return { label: "Démarrer la mesure du point neutre — 3 s", run: startNeutralCapture };
    if (nextTask?.id === "amplitude-left") return {
      label: calibration.left.active ? "Arrêter et analyser le stick gauche" : "Démarrer le test du stick gauche",
      run: () => toggleCalibration("left"),
    };
    if (nextTask?.id === "amplitude-right") return {
      label: calibration.right.active ? "Arrêter et analyser le stick droit" : "Démarrer le test du stick droit",
      run: () => toggleCalibration("right"),
    };
  }
  if (stepId === "triggers") {
    if (nextTask?.id === "vibration-strong" && nextTask.state !== "active") return {
      label: nextTask.state === "error" ? "Réessayer le moteur gauche" : "Tester le moteur gauche — 600 ms",
      run: () => runGuidedMotorTest("strong"),
    };
    if (nextTask?.id === "vibration-weak" && nextTask.state !== "active") return {
      label: nextTask.state === "error" ? "Réessayer le moteur droit" : "Tester le moteur droit — 600 ms",
      run: () => runGuidedMotorTest("weak"),
    };
  }
  if (stepId === "buttons" && nextTask) return { label: "Voir les consignes du diagnostic", run: () => openMashTestBtn.click() };
  if (stepId === "summary") return {
    label: pdfExportInProgress ? "Préparation du rapport PDF…" : "Exporter le rapport PDF",
    run: exportDiagnosticReport,
  };
  return null;
}

function renderGuideTasks(stepId, stepState) {
  guideTaskList.replaceChildren();
  for (const item of stepState.tasks) {
    const row = document.createElement("li");
    row.className = `guide-task guide-task--${item.state}`;
    const marker = document.createElement("span");
    marker.className = "guide-task-marker";
    marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "guide-task-copy";
    const label = document.createElement("strong");
    label.textContent = item.label;
    const detail = document.createElement("small");
    detail.textContent = item.detail;
    const status = document.createElement("span");
    status.className = "guide-task-status";
    status.textContent = TASK_STATE_LABELS[item.state];
    copy.append(label, detail);
    row.append(marker, copy, status);
    guideTaskList.appendChild(row);
  }
  guideTaskList.classList.toggle("hidden", stepId === "summary");
}

function renderGuidedSummary() {
  const report = buildDiagnosticReport();
  const items = computeDiagnosticVerdict(report);
  const summaryResults = document.getElementById("summaryResults");
  const summaryConfidence = document.getElementById("summaryConfidence");
  const summaryLead = document.getElementById("summaryLead");
  const summaryState = getDiagnosticSummaryState(items);

  summaryConfidence.dataset.status = summaryState.status;
  summaryConfidence.textContent = summaryState.label;
  summaryLead.textContent = summaryState.lead;
  summaryResults.replaceChildren();

  for (const item of items) {
    const card = document.createElement("article");
    card.className = `result-card result-card--${item.status}`;
    const status = document.createElement("span");
    status.className = "result-card-status";
    status.textContent = item.label || (item.status === "ok" ? "Mesure cohérente" : item.status === "warn" ? "À confirmer" : item.status === "bad" ? "Problème probable" : "Non testé");
    const title = document.createElement("h3");
    title.textContent = item.title;
    const text = document.createElement("p");
    text.textContent = item.text;
    card.append(status, title, text);
    summaryResults.appendChild(card);
  }
}

function renderGuide() {
  const step = GUIDE_STEPS[guideStepIndex];
  const flow = getGuideFlow();
  const stepState = flow.steps[step.id];
  const nextTask = stepState.tasks.find((item) => item.state === "active") || stepState.tasks.find((item) => item.state === "error") || stepState.tasks.find((item) => item.state === "pending");
  guideKicker.textContent = `Étape ${guideStepIndex + 1} sur ${GUIDE_STEPS.length} · ${step.label}`;
  const waitingForPad = !isPadConnected && step.id === "overview";
  guideTitle.textContent = waitingForPad ? "Connectez une manette pour commencer" : step.title;
  guideDescription.textContent = waitingForPad
    ? "Branchez-la en USB ou associez-la en Bluetooth, puis appuyez sur un bouton pour que le navigateur la détecte."
    : step.description;
  guideProgressLabel.textContent = step.id === "overview"
    ? stepState.state === "complete" ? "Manette détectée" : "Connexion en attente"
    : stepState.totalCount
      ? stepState.state === "skipped"
      ? "Étape passée — mesures manquantes"
      : `${stepState.completedCount} ${stepState.completedCount === 1 ? "mesure terminée" : "mesures terminées"} sur ${stepState.totalCount}`
      : "Synthèse du diagnostic";
  guidePrevBtn.disabled = guideStepIndex === 0;
  const canContinue = stepState.state === "complete" || stepState.state === "skipped";
  guideNextBtn.classList.toggle("hidden", !canContinue || guideStepIndex === GUIDE_STEPS.length - 1);
  guideNextBtn.disabled = !isPadConnected;
  const nextStepLabels = { sticks: "les sticks", triggers: "les gâchettes", buttons: "les boutons", summary: "les résultats" };
  guideNextBtn.textContent = guideStepIndex < GUIDE_STEPS.length - 1 ? `Continuer vers ${nextStepLabels[GUIDE_STEPS[guideStepIndex + 1].id]}` : "Diagnostic parcouru";

  const actionableTask = nextTask || (step.id === "summary" ? null : undefined);
  let [nowTitle, nowDescription] = taskInstruction(step.id, actionableTask?.id);
  const vibrationSide = actionableTask?.id === "vibration-strong" ? "strong" : actionableTask?.id === "vibration-weak" ? "weak" : null;
  if (vibrationSide && actionableTask.state === "active") {
    nowTitle = vibrationSide === "strong" ? "Commande envoyée au moteur gauche" : "Commande envoyée au moteur droit";
    nowDescription = "Patientez pendant les 600 ms de vibration. Le parcours avancera automatiquement à la fin de la commande.";
  } else if (vibrationSide && actionableTask.state === "error") {
    nowTitle = vibrationSide === "strong" ? "La commande du moteur gauche a échoué" : "La commande du moteur droit a échoué";
    nowDescription = "La commande a été refusée ou interrompue. Gardez cet onglet visible, puis réessayez.";
  }
  guideNowTitle.textContent = nowTitle;
  guideNowDescription.textContent = nowDescription;
  renderGuideTasks(step.id, stepState);

  const action = getGuideAction(step.id, actionableTask);
  guideContextHandler = action?.run || null;
  guideContextAction.classList.toggle("hidden", !action);
  guideContextAction.textContent = action?.label || "";
  guideContextAction.disabled = step.id === "summary" && pdfExportInProgress;
  guideSkipBtn.classList.toggle("hidden", !isPadConnected || !["sticks", "triggers", "buttons"].includes(step.id) || canContinue);

  const announcement = `${step.label}. ${guideProgressLabel.textContent}. ${nowTitle}. ${nowDescription}`;
  if (announcement !== lastGuideAnnouncement) {
    guideLiveStatus.textContent = announcement;
    lastGuideAnnouncement = announcement;
  }

  const firstBlockingIndex = GUIDE_STEPS.slice(0, -1).findIndex(({ id }) => !["complete", "skipped"].includes(flow.steps[id].state));
  guideStepButtons.forEach((button, index) => {
    const active = index === guideStepIndex;
    const buttonStepState = flow.steps[GUIDE_STEPS[index].id];
    button.classList.toggle("active", active);
    button.toggleAttribute("aria-current", active);
    button.dataset.state = buttonStepState.state;
    button.setAttribute("aria-label", `${GUIDE_STEPS[index].label} — ${STEP_STATE_LABELS[buttonStepState.state] || "Synthèse"}`);
    button.disabled = (!isPadConnected && index > 0) || (firstBlockingIndex >= 0 && index > firstBlockingIndex);
  });

  guideSections.forEach((section) => {
    const visible = appMode === "lab" || section.dataset.guideSection === step.id;
    section.classList.toggle("guide-hidden", !visible);
  });

  guideShell.classList.toggle("guide-shell--lab", appMode === "lab");
  document.body.dataset.appMode = appMode;
  if (step.id === "summary" || appMode === "lab") renderGuidedSummary();
}

function setAppMode(mode) {
  appMode = mode === "lab" ? "lab" : "guided";
  modeButtons.forEach((button) => {
    const active = button.dataset.appMode === appMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderGuide();
}

modeButtons.forEach((button) => button.addEventListener("click", () => setAppMode(button.dataset.appMode)));
labNavButtons.forEach((button) => button.addEventListener("click", () => {
  if (appMode !== "lab") return;
  const target = document.getElementById(button.dataset.labTarget);
  target?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
}));
guideStepButtons.forEach((button, index) => button.addEventListener("click", () => {
  guideStepIndex = index;
  renderGuide();
}));
guidePrevBtn.addEventListener("click", () => {
  guideStepIndex = Math.max(0, guideStepIndex - 1);
  renderGuide();
});
guideNextBtn.addEventListener("click", () => {
  guideStepIndex = Math.min(GUIDE_STEPS.length - 1, guideStepIndex + 1);
  renderGuide();
});
guideSkipBtn.addEventListener("click", () => {
  skippedGuideSteps.add(GUIDE_STEPS[guideStepIndex].id);
  guideStepIndex = Math.min(GUIDE_STEPS.length - 1, guideStepIndex + 1);
  renderGuide();
});
guideContextAction.addEventListener("click", () => {
  skippedGuideSteps.delete(GUIDE_STEPS[guideStepIndex].id);
  guideContextHandler?.();
  renderGuide();
});

function setConnectedUI(connected) {
  if (isPadConnected === connected) return;
  isPadConnected = connected;
  document.body.dataset.connectionState = connected ? "connected" : "disconnected";
  dot.classList.toggle("connected", connected);
  emptyState.classList.toggle("visible", !connected);
  grid.classList.toggle("disconnected", !connected);
  grid.toggleAttribute("inert", !connected);
  grid.setAttribute("aria-hidden", String(!connected));
  exportReportBtn.disabled = !connected;
  openMashTestBtn.disabled = !connected;
  if (!connected) {
    padName.textContent = "Aucune manette détectée";
    document.getElementById("deviceName").textContent = "Aucune manette";
    document.getElementById("deviceMapping").textContent = "Connectez une manette pour vérifier son mapping.";
    document.getElementById("deviceButtons").textContent = "— boutons";
    document.getElementById("deviceAxes").textContent = "— axes";
    document.getElementById("deviceSupport").textContent = "Compatibilité inconnue";
  }
  renderGuide();
}

const themeSelect = document.getElementById("themeSelect");
for (const [id, theme] of Object.entries(THEMES)) {
  const opt = document.createElement("option");
  opt.value = id;
  opt.textContent = theme.label;
  themeSelect.appendChild(opt);
}
const savedTheme = getTheme();
themeSelect.value = savedTheme;
applyTheme(savedTheme);
themeSelect.addEventListener("change", () => {
  applyTheme(themeSelect.value);
  setTheme(themeSelect.value);
});

const leftCanvas = document.getElementById("leftCanvas");
const rightCanvas = document.getElementById("rightCanvas");
const leftCtx = leftCanvas.getContext("2d");
const rightCtx = rightCanvas.getContext("2d");

const sliders = {
  left: {
    inner: document.getElementById("leftInner"),
    outer: document.getElementById("leftOuter"),
    innerVal: document.getElementById("leftInnerVal"),
    outerVal: document.getElementById("leftOuterVal"),
  },
  right: {
    inner: document.getElementById("rightInner"),
    outer: document.getElementById("rightOuter"),
    innerVal: document.getElementById("rightInnerVal"),
    outerVal: document.getElementById("rightOuterVal"),
  },
};

function syncSliderLabels() {
  for (const side of ["left", "right"]) {
    sliders[side].innerVal.textContent = Number(sliders[side].inner.value).toFixed(2);
    sliders[side].outerVal.textContent = Number(sliders[side].outer.value).toFixed(2);
  }
}
for (const side of ["left", "right"]) {
  sliders[side].inner.addEventListener("input", syncSliderLabels);
  sliders[side].outer.addEventListener("input", syncSliderLabels);
}
syncSliderLabels();

const buttonsGrid = document.getElementById("buttonsGrid");
let buttonCells = [];
let currentLabels = [];

const silhouette = createSilhouette(document.getElementById("silhouetteContainer"));
let currentSilhouetteType = null;

function rebuildButtonGrid(labels) {
  currentLabels = labels;
  buttonsGrid.innerHTML = "";
  buttonCells = labels.map((label, i) => {
    const cell = document.createElement("div");
    cell.className = "btn-cell";
    cell.textContent = label;
    cell.dataset.index = i;
    buttonsGrid.appendChild(cell);
    return cell;
  });
}

const padSelect = document.getElementById("padSelect");
let selectedPadIndex = null;

function refreshPadList() {
  const pads = getConnectedGamepads();
  const previousValue = padSelect.value;
  padSelect.innerHTML = "";
  if (pads.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Aucune manette";
    padSelect.appendChild(opt);
    selectedPadIndex = null;
    return;
  }
  for (const pad of pads) {
    const opt = document.createElement("option");
    opt.value = pad.index;
    opt.textContent = `#${pad.index} : ${pad.id}`;
    padSelect.appendChild(opt);
  }
  const stillConnected = pads.some((p) => String(p.index) === previousValue);
  padSelect.value = stillConnected ? previousValue : String(pads[0].index);
  selectedPadIndex = Number(padSelect.value);
}

function getSelectedGamepad() {
  const pads = getConnectedGamepads();
  return pads.find((p) => p.index === selectedPadIndex) || pads[0] || null;
}

padSelect.addEventListener("change", () => {
  selectedPadIndex = padSelect.value === "" ? null : Number(padSelect.value);
});

refreshPadList();

const ltBar = document.getElementById("ltBar");
const rtBar = document.getElementById("rtBar");
const ltVal = document.getElementById("ltVal");
const rtVal = document.getElementById("rtVal");

const vibNote = document.getElementById("vibNote");
const vibStatus = document.getElementById("vibStatus");
const vibStopBtn = document.getElementById("vibStop");
const motorCardStrong = document.getElementById("motorCardStrong");
const motorCardWeak = document.getElementById("motorCardWeak");


let vibrationActive = false;

function setVibrationActive(active) {
  vibrationActive = active;
  vibStopBtn.classList.toggle("hidden", !active);
}

function updateVibStatus() {
  const pad = getSelectedGamepad();
  vibStatus.classList.remove("vib-status--ok", "vib-status--warn");
  if (!pad) {
    vibStatus.textContent = "Aucune manette";
  } else if (!pad.vibrationActuator) {
    vibStatus.textContent = "Non prise en charge";
    vibStatus.classList.add("vib-status--warn");
  } else {
    vibStatus.textContent = "Vibration disponible";
    vibStatus.classList.add("vib-status--ok");
  }
}

// L'API confirme l'achèvement de la commande, jamais la force réellement produite
// par le moteur. La pulsation illustre donc l'envoi, pas un retour physique mesuré.
function pulseMotorCard(card, duration) {
  card.classList.add("active");
  setTimeout(() => card.classList.remove("active"), duration);
}

async function playRumble(weak, strong, duration = 600, { cards = [], reportInterruption = true } = {}) {
  const pad = getSelectedGamepad();
  const actuator = pad?.vibrationActuator;
  if (!actuator) {
    vibNote.textContent = "Vibration non supportée par cette manette/navigateur.";
    return { status: "unsupported" };
  }
  for (const card of cards) pulseMotorCard(card, duration);
  const outcome = await executeHapticCommand(() => actuator.playEffect("dual-rumble", {
      startDelay: 0,
      duration,
      weakMagnitude: weak,
      strongMagnitude: strong,
    }));
  if (outcome.status === "error") {
    if (outcome.reason === "preempted") {
      if (reportInterruption) vibNote.textContent = "Commande de vibration interrompue avant sa fin.";
    } else {
      vibNote.textContent = "Commande de vibration refusée. Gardez cet onglet visible, puis réessayez.";
      resetVibrationUI();
    }
    return { status: "error" };
  }
  vibNote.textContent = "";
  return { status: "complete" };
}

async function runGuidedMotorTest(side) {
  const sessionRevision = diagnosticSession.revision;
  const button = document.getElementById(side === "strong" ? "vibStrongTest" : "vibWeakTest");
  const card = side === "strong" ? motorCardStrong : motorCardWeak;
  vibrationCommands[side] = "running";
  skippedGuideSteps.delete("triggers");
  button.disabled = true;
  renderGuide();
  const result = side === "strong"
    ? await playRumble(0, 1, 600, { cards: [card] })
    : await playRumble(1, 0, 600, { cards: [card] });
  button.disabled = false;
  if (sessionRevision !== diagnosticSession.revision) return;
  vibrationCommands[side] = result.status === "complete" ? "complete" : "error";
  if (result.status === "complete") {
    vibNote.textContent = "Commande envoyée. L'application ne peut pas mesurer la force réellement produite.";
  }
  renderGuide();
}

const vibStrongLive = document.getElementById("vibStrongLive");
const vibWeakLive = document.getElementById("vibWeakLive");
const vibStrongLiveVal = document.getElementById("vibStrongLiveVal");
const vibWeakLiveVal = document.getElementById("vibWeakLiveVal");
let liveRumbleTimer = null;

// Ne fait que remettre l'UI à plat (pas d'appel à playRumble): playRumble appelle
// cette fonction dans son .catch, donc rappeler playRumble ici créerait une boucle
// infinie si la manette continue de refuser l'effet (ex: stopLiveRumble -> playRumble
// -> refus -> resetVibrationUI -> ... si elle rappelait stopLiveRumble).
function resetVibrationUI() {
  clearInterval(liveRumbleTimer);
  liveRumbleTimer = null;
  vibStrongLive.value = 0;
  vibWeakLive.value = 0;
  vibStrongLiveVal.textContent = "0%";
  vibWeakLiveVal.textContent = "0%";
  motorCardStrong.classList.remove("active");
  motorCardWeak.classList.remove("active");
  setVibrationActive(false);
}

function stopLiveRumble() {
  resetVibrationUI();
  playRumble(0, 0, 1, { reportInterruption: false });
}

function syncLiveRumble() {
  const weak = Number(vibWeakLive.value);
  const strong = Number(vibStrongLive.value);
  vibWeakLiveVal.textContent = `${Math.round(weak * 100)}%`;
  vibStrongLiveVal.textContent = `${Math.round(strong * 100)}%`;
  motorCardWeak.classList.toggle("active", weak > 0);
  motorCardStrong.classList.toggle("active", strong > 0);

  clearInterval(liveRumbleTimer);
  liveRumbleTimer = null;
  if (weak === 0 && strong === 0) {
    setVibrationActive(false);
    return;
  }

  setVibrationActive(true);
  // playEffect ne propose pas de mode infini : on rejoue l'effet en boucle
  // pour simuler une vibration continue tant qu'un curseur est actif.
  const refresh = () => playRumble(weak, strong, 300, { reportInterruption: false });
  refresh();
  liveRumbleTimer = setInterval(refresh, 250);
}

vibStrongLive.addEventListener("input", syncLiveRumble);
vibWeakLive.addEventListener("input", syncLiveRumble);

document.getElementById("vibStrongTest").addEventListener("click", () => runGuidedMotorTest("strong"));
document.getElementById("vibWeakTest").addEventListener("click", () => runGuidedMotorTest("weak"));
document.getElementById("presetLight").addEventListener("click", () =>
  playRumble(0.2, 0.2, 600, { cards: [motorCardStrong, motorCardWeak] })
);
document.getElementById("presetBalanced").addEventListener("click", () =>
  playRumble(0.5, 0.5, 600, { cards: [motorCardStrong, motorCardWeak] })
);
document.getElementById("presetIntense").addEventListener("click", () =>
  playRumble(1, 1, 600, { cards: [motorCardStrong, motorCardWeak] })
);
vibStopBtn.addEventListener("click", () => stopLiveRumble());

function themeColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function drawStick(ctx, canvas, rawX, rawY, adjX, adjY, inner, outer, trail) {
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 10;
  const accent = themeColor("--accent-alt");
  const primary = themeColor("--accent");
  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#1f2333";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(center, center, radius * outer, 0, Math.PI * 2);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(center, center, radius * inner, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.08;
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.moveTo(center - radius, center);
  ctx.lineTo(center + radius, center);
  ctx.moveTo(center, center - radius);
  ctx.lineTo(center, center + radius);
  ctx.strokeStyle = "#1f2333";
  ctx.stroke();

  if (trail && trail.length) {
    ctx.fillStyle = primary;
    ctx.globalAlpha = 0.35;
    for (const p of trail) {
      ctx.beginPath();
      ctx.arc(center + p.x * radius, center + p.y * radius, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // raw position (dim)
  ctx.beginPath();
  ctx.arc(center + rawX * radius, center + rawY * radius, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#3a3f55";
  ctx.fill();

  // adjusted position (neon)
  ctx.beginPath();
  ctx.arc(center + adjX * radius, center + adjY * radius, 6, 0, Math.PI * 2);
  ctx.fillStyle = primary;
  ctx.shadowColor = primary;
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;
}

const triggerHistoryCanvas = document.getElementById("triggerHistoryGraph");
const triggerHistoryCtx = triggerHistoryCanvas.getContext("2d");
const triggerHistoryLT = new Array(triggerHistoryCanvas.width).fill(0);
const triggerHistoryRT = new Array(triggerHistoryCanvas.width).fill(0);

function drawTriggerHistory(ctx, canvas, ltHistory, rtHistory) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#1f2333";
  ctx.beginPath();
  ctx.moveTo(0, h - 4);
  ctx.lineTo(w, h - 4);
  ctx.stroke();

  function drawTrace(history, color) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < history.length; i++) {
      const y = h - 4 - history[i] * (h - 8);
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.stroke();
  }

  drawTrace(ltHistory, themeColor("--accent"));
  drawTrace(rtHistory, themeColor("--accent-alt"));
}

const driftCanvasLeft = document.getElementById("driftGraphLeft");
const driftCanvasRight = document.getElementById("driftGraphRight");
const driftCtxLeft = driftCanvasLeft.getContext("2d");
const driftCtxRight = driftCanvasRight.getContext("2d");
const driftHistoryLeft = new Array(driftCanvasLeft.width).fill(0);
const driftHistoryRight = new Array(driftCanvasRight.width).fill(0);

function drawDrift(ctx, canvas, history) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#1f2333";
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = themeColor("--accent");
  ctx.lineWidth = 1.5;
  for (let i = 0; i < history.length; i++) {
    const y = h / 2 - history[i] * (h / 2 - 4);
    if (i === 0) ctx.moveTo(i, y);
    else ctx.lineTo(i, y);
  }
  ctx.stroke();
}


const calibrationControls = {};

function setupCalibration(side, buttonId, resultId, resetId) {
  const btn = document.getElementById(buttonId);
  const resultEl = document.getElementById(resultId);
  const resetBtn = document.getElementById(resetId);
  const state = calibration[side];

  calibrationControls[side] = { btn, resultEl };
  btn.addEventListener("click", () => toggleCalibration(side));

  resetBtn.addEventListener("click", () => {
    diagnosticSession.resetCalibration(side);
    syncCalibrationUI(side);
    renderGuide();
  });
}

function syncCalibrationUI(side) {
  const { btn, resultEl } = calibrationControls[side];
  btn.textContent = "Tester l'amplitude du stick";
  resultEl.textContent = calibration[side].result?.message || "";
}

function toggleCalibration(side) {
  const state = calibration[side];
  const { btn, resultEl } = calibrationControls[side];
  skippedGuideSteps.delete("sticks");
  if (!state.active) {
    state.active = true;
    state.completed = false;
    state.points = [];
    state.result = null;
    btn.textContent = "Arrêter & afficher le résultat";
    resultEl.textContent = "Calibration en cours, faites le tour complet du stick...";
  } else {
    state.active = false;
    btn.textContent = "Tester l'amplitude du stick";
    if (state.points.length < 5) {
      state.completed = false;
      state.result = null;
      resultEl.textContent = "Pas assez de données, réessayez.";
      renderGuide();
      return;
    }
    state.result = analyzeStickRange(state.points);
    state.completed = state.result.state !== "incomplete";
    resultEl.textContent = state.result.message;
  }
  renderGuide();
}
setupCalibration("left", "leftCalibBtn", "leftCalibResult", "leftCalibReset");
setupCalibration("right", "rightCalibBtn", "rightCalibResult", "rightCalibReset");


const neutralResultEls = {
  left: document.getElementById("leftNeutralResult"),
  right: document.getElementById("rightNeutralResult"),
};
const neutralCaptureStatus = document.getElementById("neutralCaptureStatus");
const measureNeutralBtn = document.getElementById("measureNeutralBtn");
const NEUTRAL_CAPTURE_DURATION_MS = 3000;


function neutralDriftStatus(offset) {
  if (!offset.measured) return { key: "na", label: "Point neutre : non testé" };
  if (offset.magnitude > NEUTRAL_DRIFT_WARN_THRESHOLD) {
    return {
      key: "fair",
      label: `Point neutre décalé : ${offset.x.toFixed(3)}, ${offset.y.toFixed(3)} (à confirmer)`,
    };
  }
  return { key: "excellent", label: `Point neutre : ${offset.x.toFixed(3)}, ${offset.y.toFixed(3)} (centré)` };
}

function renderNeutralDrift(side) {
  const offset = neutralDrift[side].getOffset();
  const status = neutralDriftStatus(offset);
  const el = neutralResultEls[side];
  el.textContent = status.label;
  el.className = `note mash-grade-${status.key}`;
  return offset;
}

function finishNeutralCapture() {
  const left = neutralDrift.left.getOffset();
  const right = neutralDrift.right.getOffset();
  const invalid = diagnosticSession.neutralCapture.maxFrameGapMs > 100 || !left.measured || !right.measured;
  diagnosticSession.neutralCapture = null;
  measureNeutralBtn.disabled = false;
  guideContextAction.disabled = false;
  measureNeutralBtn.textContent = "Mesurer le point neutre";

  if (invalid) {
    neutralDrift.left.reset();
    neutralDrift.right.reset();
    neutralCaptureStatus.textContent = "Mesure invalide : la manette a bougé ou le navigateur a ralenti. Recommencez sans toucher aux sticks.";
    neutralCaptureStatus.dataset.status = "warn";
  } else {
    neutralCaptureStatus.textContent = "Mesure terminée sur trois secondes. Les résultats sont affichés pour chaque stick.";
    neutralCaptureStatus.dataset.status = "ok";
  }
  renderNeutralDrift("left");
  renderNeutralDrift("right");
  renderGuide();
}

function updateNeutralCapture(lx, ly, rx, ry, now, frameGapMs) {
  if (!diagnosticSession.neutralCapture) return;
  diagnosticSession.neutralCapture.maxFrameGapMs = Math.max(diagnosticSession.neutralCapture.maxFrameGapMs, frameGapMs);
  neutralDrift.left.update(lx, ly, now);
  neutralDrift.right.update(rx, ry, now);
  const remainingMs = Math.max(0, diagnosticSession.neutralCapture.endAt - now);
  const remainingSeconds = (remainingMs / 1000).toFixed(1);
  neutralCaptureStatus.textContent = `Mesure en cours : ne touchez pas à la manette pendant encore ${remainingSeconds} s.`;
  neutralCaptureStatus.dataset.status = "active";
  measureNeutralBtn.textContent = `${remainingSeconds} s`;
  renderNeutralDrift("left");
  renderNeutralDrift("right");
  if (remainingMs <= 0) finishNeutralCapture();
}

function startNeutralCapture() {
  if (!getSelectedGamepad() || diagnosticSession.neutralCapture) return;
  skippedGuideSteps.delete("sticks");
  neutralDrift.left.reset();
  neutralDrift.right.reset();
  const now = performance.now();
  diagnosticSession.neutralCapture = { endAt: now + NEUTRAL_CAPTURE_DURATION_MS, maxFrameGapMs: 0 };
  measureNeutralBtn.disabled = true;
  guideContextAction.disabled = true;
  neutralCaptureStatus.textContent = "Mesure en cours : ne touchez plus à la manette.";
  neutralCaptureStatus.dataset.status = "active";
  renderGuide();
}

measureNeutralBtn.addEventListener("click", startNeutralCapture);


const triggerStabilityResultEls = {
  lt: document.getElementById("ltStabilityResult"),
  rt: document.getElementById("rtStabilityResult"),
};
const triggerGuideStates = { lt: "idle", rt: "idle" };

function syncTriggerGuideState(side, tracker, result) {
  const nextState = result.measured ? "complete" : tracker.isAttempting() ? "active" : "idle";
  if (nextState === triggerGuideStates[side]) return;
  triggerGuideStates[side] = nextState;
  if (nextState !== "idle") skippedGuideSteps.delete("triggers");
  renderGuide();
}

function triggerStabilityStatus(result) {
  if (!result.measured) return { key: "na", label: "Stabilité : maintenez à mi-course pour mesurer..." };
  const grade = triggerStabilityGrade(result);
  const detail = `écart ${(result.range * 100).toFixed(1)}%, ${result.stepCount} saut(s)`;
  if (grade.key === "poor") {
    return { key: "poor", label: `Stabilité : instable (${detail})` };
  }
  if (grade.key === "fair") {
    return grade.isolated
      ? { key: "fair", label: `Stabilité : écart isolé (${detail}), retestez pour confirmer` }
      : { key: "fair", label: `Stabilité : léger bruit (${detail})` };
  }
  return { key: "excellent", label: `Stabilité : lisse (écart ${(result.range * 100).toFixed(1)} %) ✓` };
}

function renderTriggerStability(side, now) {
  const tracker = triggerStability[side];
  const result = tracker.getResult();
  const el = triggerStabilityResultEls[side];

  // Une nouvelle tentative en cours doit être visible même si un résultat précédent est
  // déjà affiché, sinon on ne voit jamais qu'un nouveau test a démarré après relâchement.
  if (tracker.isAttempting()) {
    const remainingS = ((1 - tracker.getProgress(now)) * TRIGGER_REQUIRED_HOLD_MS) / 1000;
    el.textContent = result.measured
      ? `Stabilité : nouvelle mesure en cours, maintenez encore ${remainingS.toFixed(1)} s...`
      : `Stabilité : maintenez encore ${remainingS.toFixed(1)} s...`;
    el.className = "note mash-grade-na";
    syncTriggerGuideState(side, tracker, result);
    return result;
  }
  if (!result.measured) {
    el.textContent = "Stabilité : maintenez à mi-course pour mesurer...";
    el.className = "note mash-grade-na";
    syncTriggerGuideState(side, tracker, result);
    return result;
  }
  const status = triggerStabilityStatus(result);
  el.textContent = status.label;
  el.className = `note mash-grade-${status.key}`;
  syncTriggerGuideState(side, tracker, result);
  return result;
}

const mashOverlay = document.getElementById("mashOverlay");
const mashSetupEl = document.getElementById("mashSetup");
const mashRunningEl = document.getElementById("mashRunning");
const mashSummaryEl = document.getElementById("mashSummary");
const mashDurationSelect = document.getElementById("mashDuration");
const mashProgressEl = document.getElementById("mashProgress");
const mashCurrentLabelEl = document.getElementById("mashCurrentLabel");
const mashTimerFillEl = document.getElementById("mashTimerFill");
const mashCountEl = document.getElementById("mashCount");
const mashSummaryTableEl = document.getElementById("mashSummaryTable");
const mashSetupWarningEl = document.getElementById("mashSetupWarning");
const mashStartBtnEl = document.getElementById("mashStartBtn");
const mashEstimateEl = document.getElementById("mashEstimate");
const mashPanelEl = mashOverlay.querySelector(".mash-panel");

let mashTest = null;
let mashReturnFocus = null;

function showMashScreen(screen) {
  mashSetupEl.classList.toggle("hidden", screen !== "setup");
  mashRunningEl.classList.toggle("hidden", screen !== "running");
  mashSummaryEl.classList.toggle("hidden", screen !== "summary");
}

function closeMashOverlay() {
  mashOverlay.classList.remove("visible");
  mashOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("dialog-open");
  mashReturnFocus?.focus();
  mashReturnFocus = null;
}

function renderMashSummaryTable(results) {
  mashSummaryTableEl.replaceChildren();

  const totalPressCount = results.reduce((sum, r) => sum + r.pressCount, 0);
  const totalChatter = results.reduce((sum, r) => sum + r.chatterCount, 0);
  const overallGrade = gradeForChatter(totalChatter, totalPressCount);
  const overall = document.createElement("p");
  overall.className = `mash-overall-grade mash-grade-${overallGrade.key}`;
  overall.textContent = `Fiabilité globale : ${reliabilityAdjective(overallGrade, { capitalized: true })} (${totalChatter} double(s) déclenchement(s) sur ${totalPressCount} appuis)`;
  mashSummaryTableEl.appendChild(overall);

  const table = document.createElement("table");
  table.className = "mash-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const text of ["Bouton", "Appuis", "Appuis/s", "Chatter", "Fiabilité"]) {
    const th = document.createElement("th");
    th.textContent = text;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const unreliableButtons = [];
  for (const r of results) {
    const grade = gradeForChatter(r.chatterCount, r.pressCount);
    const row = document.createElement("tr");
    const cells = [r.label, String(r.pressCount), r.pressesPerSecond.toFixed(1), String(r.chatterCount)];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      if (i > 0) td.className = "mono";
      td.textContent = text;
      row.appendChild(td);
    });
    const gradeTd = document.createElement("td");
    gradeTd.className = `mash-grade-${grade.key}`;
    gradeTd.textContent = r.reliable === false ? `⚠ ${grade.label}` : grade.label;
    if (r.reliable === false) {
      gradeTd.title = `Mesure perturbée: ralentissement de ${r.maxStallGapMs} ms détecté pendant le test (onglet en arrière-plan ou navigateur surchargé). Retester ce bouton recommandé.`;
      unreliableButtons.push(r.label);
    }
    row.appendChild(gradeTd);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  mashSummaryTableEl.appendChild(table);

  if (unreliableButtons.length) {
    const warning = document.createElement("p");
    warning.className = "note mash-reliability-warning";
    warning.textContent = `⚠ Mesure potentiellement perturbée pour: ${unreliableButtons.join(", ")}, un ralentissement du navigateur a été détecté pendant ce test (onglet en arrière-plan, charge CPU...). Retestez ce(s) bouton(s) avant de conclure.`;
    mashSummaryTableEl.appendChild(warning);
  }

  const TONE_TO_GRADE_CLASS = { ok: "excellent", warn: "fair", bad: "poor", neutral: "na" };
  const verdict = buildMashVerdict(results);
  const verdictEl = document.createElement("p");
  verdictEl.className = `mash-verdict mash-grade-${TONE_TO_GRADE_CLASS[verdict.tone]}`;
  verdictEl.textContent = verdict.text;
  mashSummaryTableEl.appendChild(verdictEl);

  const limits = document.createElement("p");
  limits.className = "note mash-limits-note";
  limits.textContent = "Ce diagnostic dépend du navigateur et du système (fréquence de lecture de la manette, throttling en arrière-plan...), il donne une bonne indication mais ne remplace pas un diagnostic matériel certifié.";
  mashSummaryTableEl.appendChild(limits);
}

function updateMashRunningUI(now) {
  if (!mashTest || mashTest.finished) return;
  const current = mashTest.currentButton;
  const waiting = mashTest.windowStart == null;
  mashProgressEl.textContent = `Bouton ${mashTest.currentIdx + 1} / ${mashTest.queue.length}${waiting ? " (appuyez pour démarrer le chrono)" : ""}`;
  mashCurrentLabelEl.textContent = current.label;
  mashTimerFillEl.style.width = waiting ? "0%" : `${mashTest.progressFraction(now) * 100}%`;
  mashCountEl.textContent = mashTest.pressCount;
}

function formatEstimatedDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

function updateMashEstimate() {
  const pad = getSelectedGamepad();
  if (!pad) {
    mashEstimateEl.textContent = "Connectez une manette pour calculer la durée du test.";
    mashStartBtnEl.textContent = "Commencer le test";
    return;
  }
  const queue = buildMashQueue(currentLabels, pad.buttons.length);
  const totalSeconds = Math.round((queue.length * Number(mashDurationSelect.value)) / 1000);
  const durationLabel = formatEstimatedDuration(totalSeconds);
  mashEstimateEl.textContent = `${queue.length} boutons utiles · durée minimale estimée : ${durationLabel}. Le chrono de chaque bouton démarre au premier appui.`;
  mashStartBtnEl.textContent = `Commencer le test — environ ${durationLabel}`;
}

function openMashSetup() {
  const hasPad = Boolean(getSelectedGamepad());
  mashSetupWarningEl.textContent = hasPad ? "" : "Aucune manette connectée, branchez-la avant de démarrer.";
  mashStartBtnEl.disabled = !hasPad;
  updateMashEstimate();
  showMashScreen("setup");
}

mashDurationSelect.addEventListener("change", updateMashEstimate);

openMashTestBtn.addEventListener("click", () => {
  mashReturnFocus = document.activeElement;
  if (diagnosticSession.mashResults) {
    renderMashSummaryTable(diagnosticSession.mashResults);
    showMashScreen("summary");
  } else {
    openMashSetup();
  }
  mashOverlay.classList.add("visible");
  mashOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("dialog-open");
  requestAnimationFrame(() => mashPanelEl.focus());
});

mashOverlay.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeMashOverlay();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...mashOverlay.querySelectorAll("button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

document.getElementById("mashCancelSetupBtn").addEventListener("click", closeMashOverlay);

document.getElementById("mashRetestBtn").addEventListener("click", () => {
  diagnosticSession.mashResults = null;
  renderGuide();
  openMashSetup();
});

mashStartBtnEl.addEventListener("click", () => {
  const pad = getSelectedGamepad();
  if (!pad) return;
  skippedGuideSteps.delete("buttons");
  const durationMs = Number(mashDurationSelect.value);
  const queue = buildMashQueue(currentLabels, pad.buttons.length);
  mashTest = new MashSequenceTest(queue, durationMs);
  showMashScreen("running");
});

document.getElementById("mashAbortBtn").addEventListener("click", () => {
  mashTest = null;
  closeMashOverlay();
});

document.getElementById("mashCloseBtn").addEventListener("click", closeMashOverlay);

const pressLog = document.getElementById("pressLog");
const PRESS_LOG_LIMIT = 10;


function logPress(label, { value, eventTime, chatterDelayMs = null }) {
  const entry = document.createElement("div");
  const time = new Date().toLocaleTimeString("fr-FR", { hour12: false });
  const timeEl = document.createElement("time");
  const labelEl = document.createElement("span");
  const valueEl = document.createElement("span");
  const intervalEl = document.createElement("span");
  const statusEl = document.createElement("span");
  const intervalMs = diagnosticSession.lastLoggedPressAt == null ? null : eventTime - diagnosticSession.lastLoggedPressAt;
  diagnosticSession.lastLoggedPressAt = eventTime;

  entry.className = "press-log-entry";
  timeEl.className = "press-log-time";
  timeEl.textContent = time;
  labelEl.className = "press-log-button";
  labelEl.textContent = label;
  labelEl.title = label;
  valueEl.className = "press-log-value";
  valueEl.textContent = `${Math.round(value * 100)} %`;
  intervalEl.className = "press-log-interval";
  intervalEl.textContent = intervalMs == null ? "—" : intervalMs < 1000 ? `+${intervalMs.toFixed(0)} ms` : `+${(intervalMs / 1000).toFixed(1)} s`;
  statusEl.className = "press-log-status";
  statusEl.textContent = chatterDelayMs != null ? "Chatter" : "Normal";
  if (chatterDelayMs != null) {
    entry.classList.add("is-chatter");
    statusEl.title = `Ré-appui ${chatterDelayMs.toFixed(1)} ms après relâche`;
  }
  entry.append(timeEl, labelEl, valueEl, intervalEl, statusEl);
  pressLog.prepend(entry);
  while (pressLog.children.length > PRESS_LOG_LIMIT) pressLog.removeChild(pressLog.lastChild);
}

let lastPadCount = 0;


const chatterCountEl = document.getElementById("chatterCount");

function buildDiagnosticReport() {
  return createDiagnosticReport({
    pad: getSelectedGamepad(),
    deadzones: {
      left: { inner: Number(sliders.left.inner.value), outer: Number(sliders.left.outer.value) },
      right: { inner: Number(sliders.right.inner.value), outer: Number(sliders.right.outer.value) },
    },
    calibration: {
      left: calibration.left.result,
      right: calibration.right.result,
    },
    neutralDrift: {
      left: neutralDrift.left.getOffset(),
      right: neutralDrift.right.getOffset(),
    },
    triggerStability: {
      lt: triggerStability.lt.getResult(),
      rt: triggerStability.rt.getResult(),
    },
    vibrationCommands,
    skippedSteps: skippedGuideSteps,
    chatterTotal: diagnosticSession.chatterTotal,
    pressCountByButton,
    chatterByButton,
    mashResults: diagnosticSession.mashResults,
  });
}


async function exportDiagnosticReport() {
  if (pdfExportInProgress) return;
  pdfExportInProgress = true;
  exportReportBtn.disabled = true;
  exportReportBtn.textContent = "Préparation du PDF…";
  exportReportStatus.dataset.status = "active";
  exportReportStatus.textContent = "Préparation du rapport PDF…";

  try {
    renderGuide();
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const report = buildDiagnosticReport();
    const doc = buildDiagnosticPdf(report, jsPDF, autoTable);
    const padSlug = report.gamepad ? slugify(report.gamepad.id).slice(0, 40) : "sans-manette";
    doc.save(`gamepad-report-${padSlug}-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`);
    exportReportStatus.dataset.status = "ok";
    exportReportStatus.textContent = "Rapport PDF généré. Le téléchargement a été lancé.";
  } catch {
    exportReportStatus.dataset.status = "error";
    exportReportStatus.textContent = "Le rapport PDF n'a pas pu être préparé. Gardez cet onglet actif, puis réessayez.";
  } finally {
    pdfExportInProgress = false;
    exportReportBtn.disabled = !isPadConnected;
    exportReportBtn.textContent = "Exporter rapport (PDF)";
    renderGuide();
  }
}

exportReportBtn.addEventListener("click", exportDiagnosticReport);

function syncDiagnosticResetUI() {
  resetVibrationUI();
  chatterCountEl.textContent = "0";
  driftHistoryLeft.fill(0);
  driftHistoryRight.fill(0);
  triggerHistoryLT.fill(0);
  triggerHistoryRT.fill(0);
  pressLog.replaceChildren();
  mashTest = null;
  guideStepIndex = 0;

  syncCalibrationUI("left");
  syncCalibrationUI("right");

  measureNeutralBtn.disabled = false;
  measureNeutralBtn.textContent = "Mesurer le point neutre";
  guideContextAction.disabled = false;
  neutralCaptureStatus.textContent = "Posez la manette à plat, relâchez les sticks, puis lancez une mesure de trois secondes.";
  delete neutralCaptureStatus.dataset.status;
  renderNeutralDrift("left");
  renderNeutralDrift("right");

  triggerGuideStates.lt = "idle";
  triggerGuideStates.rt = "idle";
  renderTriggerStability("lt", performance.now());
  renderTriggerStability("rt", performance.now());
  renderGuide();
}

function resetDiagnosticData() {
  if (!window.confirm("Réinitialiser toutes les mesures collectées (sticks, gâchettes, boutons et historique) ? Cette action est irréversible.")) return;
  diagnosticSession.reset();
  syncDiagnosticResetUI();
}

document.getElementById("resetDataBtn").addEventListener("click", resetDiagnosticData);
let lastFrameTime = performance.now();

function loop() {
  const frameNow = performance.now();
  const frameGapMs = frameNow - lastFrameTime;
  lastFrameTime = frameNow;

  const connectedCount = getConnectedGamepads().length;
  if (connectedCount !== lastPadCount) {
    lastPadCount = connectedCount;
    refreshPadList();
  }

  const pad = getSelectedGamepad();

  if (pad) {
    const sessionChanged = diagnosticSession.activate(pad);
    if (sessionChanged) syncDiagnosticResetUI();
    setConnectedUI(true);
    padName.textContent = pad.id;

    if (sessionChanged) {
      rebuildButtonGrid(getLabelsFor(pad.id));
      document.getElementById("deviceName").textContent = pad.id;
      document.getElementById("deviceButtons").textContent = `${pad.buttons.length} boutons`;
      document.getElementById("deviceAxes").textContent = `${pad.axes.length} axes`;
      const hasStandardMapping = pad.mapping === "standard";
      document.getElementById("deviceMapping").textContent = hasStandardMapping
        ? "Mapping standard reconnu : les libellés et positions peuvent être interprétés avec confiance."
        : "Mapping non standard : vérifiez visuellement chaque bouton, certains libellés peuvent différer.";
      document.getElementById("deviceSupport").textContent = hasStandardMapping ? "Mapping standard" : "À vérifier";
      document.getElementById("deviceSupport").dataset.status = hasStandardMapping ? "ok" : "warn";

      const controllerType = detectControllerType(pad.id);
      if (controllerType !== currentSilhouetteType) {
        currentSilhouetteType = controllerType;
        setSilhouetteType(silhouette, controllerType);
      }
      updateVibStatus();
    }

    const now = frameNow;
    // Le timestamp date la dernière mise à jour exposée par le navigateur. Il peut ordonner
    // les transitions observées, mais ne mesure pas la latence physique de la manette.
    const gamepadTimestamp = Number.isFinite(pad.timestamp) && pad.timestamp > 0 ? pad.timestamp : null;
    const eventTime = gamepadTimestamp ?? now;

    if (mashTest && !mashTest.finished) {
      mashTest.feed(pad.buttons, now, frameGapMs, gamepadTimestamp);
      if (mashTest.finished) {
        diagnosticSession.mashResults = mashTest.results;
        renderMashSummaryTable(diagnosticSession.mashResults);
        showMashScreen("summary");
        renderGuide();
      } else {
        updateMashRunningUI(now);
      }
    }

    const leftInner = Number(sliders.left.inner.value);
    const leftOuter = Number(sliders.left.outer.value);
    const rightInner = Number(sliders.right.inner.value);
    const rightOuter = Number(sliders.right.outer.value);

    const lx = pad.axes[0] ?? 0;
    const ly = pad.axes[1] ?? 0;
    const rx = pad.axes[2] ?? 0;
    const ry = pad.axes[3] ?? 0;

    const leftAdj = applyDeadzone(lx, ly, leftInner, leftOuter);
    const rightAdj = applyDeadzone(rx, ry, rightInner, rightOuter);

    if (calibration.left.active) calibration.left.points.push({ x: lx, y: ly });
    if (calibration.right.active) calibration.right.points.push({ x: rx, y: ry });

    updateNeutralCapture(lx, ly, rx, ry, now, frameGapMs);

    drawStick(leftCtx, leftCanvas, lx, ly, leftAdj.x, leftAdj.y, leftInner, leftOuter, calibration.left.points);
    drawStick(rightCtx, rightCanvas, rx, ry, rightAdj.x, rightAdj.y, rightInner, rightOuter, calibration.right.points);

    document.getElementById("leftRaw").textContent = `${lx.toFixed(2)}, ${ly.toFixed(2)}`;
    document.getElementById("leftAdj").textContent = `${leftAdj.x.toFixed(2)}, ${leftAdj.y.toFixed(2)}`;
    document.getElementById("rightRaw").textContent = `${rx.toFixed(2)}, ${ry.toFixed(2)}`;
    document.getElementById("rightAdj").textContent = `${rightAdj.x.toFixed(2)}, ${rightAdj.y.toFixed(2)}`;

    driftHistoryLeft.push(lx);
    driftHistoryLeft.shift();
    driftHistoryRight.push(rx);
    driftHistoryRight.shift();
    drawDrift(driftCtxLeft, driftCanvasLeft, driftHistoryLeft);
    drawDrift(driftCtxRight, driftCanvasRight, driftHistoryRight);

    const lt = pad.buttons[6]?.value ?? 0;
    const rt = pad.buttons[7]?.value ?? 0;
    ltBar.style.width = `${lt * 100}%`;
    rtBar.style.width = `${rt * 100}%`;
    ltVal.textContent = `${Math.round(lt * 100)}%`;
    rtVal.textContent = `${Math.round(rt * 100)}%`;

    triggerHistoryLT.push(lt);
    triggerHistoryLT.shift();
    triggerHistoryRT.push(rt);
    triggerHistoryRT.shift();
    drawTriggerHistory(triggerHistoryCtx, triggerHistoryCanvas, triggerHistoryLT, triggerHistoryRT);

    triggerStability.lt.update(lt, now);
    triggerStability.rt.update(rt, now);
    renderTriggerStability("lt", now);
    renderTriggerStability("rt", now);

    updateSilhouette(silhouette, pad);

    pad.buttons.forEach((btn, i) => {
      const cell = buttonCells[i];
      const wasPressed = diagnosticSession.prevButtonStates[i] || false;
      const pressed = isButtonPressed(btn, i, wasPressed);
      if (cell) {
        if (pressed) cell.classList.add("active");
        else cell.classList.remove("active");
      }
      if (pressed && !wasPressed) {
        const label = currentLabels[i] || `Bouton ${i}`;
        pressCountByButton.set(label, (pressCountByButton.get(label) || 0) + 1);
        const sinceRelease = diagnosticSession.lastReleaseTimes[i];
        if (sinceRelease != null && eventTime - sinceRelease < CHATTER_THRESHOLD_MS) {
          diagnosticSession.chatterTotal++;
          chatterByButton.set(label, (chatterByButton.get(label) || 0) + 1);
          chatterCountEl.textContent = diagnosticSession.chatterTotal;
          logPress(label, { value: btn.value, eventTime, chatterDelayMs: eventTime - sinceRelease });
          if (cell) {
            cell.classList.add("chatter");
            setTimeout(() => cell.classList.remove("chatter"), 400);
          }
        } else {
          logPress(label, { value: btn.value, eventTime });
        }
      }
      if (!pressed && wasPressed) {
        diagnosticSession.lastReleaseTimes[i] = eventTime;
      }
      diagnosticSession.prevButtonStates[i] = pressed;
    });
  } else {
    diagnosticSession.releaseController();
    setConnectedUI(false);
    updateVibStatus();
  }

  requestAnimationFrame(loop);
}

window.addEventListener("gamepadconnected", () => {
  refreshPadList();
});
window.addEventListener("gamepaddisconnected", () => {
  refreshPadList();
  if (getConnectedGamepads().length === 0) {
    setConnectedUI(false);
  }
});

requestAnimationFrame(loop);
