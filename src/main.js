import "./style.css";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  applyDeadzone,
  detectControllerType,
  getConnectedGamepads,
  getLabelsFor,
  CHATTER_THRESHOLD_MS,
  NeutralDriftTracker,
  NEUTRAL_DRIFT_WARN_THRESHOLD,
  NEUTRAL_DRIFT_BAD_THRESHOLD,
  isButtonPressed,
  TriggerStabilityTracker,
  TRIGGER_REQUIRED_HOLD_MS,
  triggerStabilityGrade,
} from "./gamepad.js";
import { getTheme, setTheme } from "./storage.js";
import { THEMES, applyTheme } from "./themes.js";
import { MashSequenceTest, buildMashQueue, gradeForChatter, chatterRate, buildMashVerdict } from "./mashTest.js";
import { createSilhouette, setSilhouetteType, updateSilhouette } from "./controllerSilhouette.js";
import { buildGuideFlow, executeHapticCommand } from "./guideFlow.js";

const app = document.getElementById("app");

app.innerHTML = `
  <header>
    <div class="header-row header-row--brand">
      <div class="header-id">
        <h1>Gamepad Tester</h1>
        <div class="status-pill"><span class="dot" id="dot"></span><span id="padName">Aucune manette détectée</span></div>
      </div>
    </div>
    <div class="header-row">
      <div class="header-controls">
        <label class="field">Thème<select id="themeSelect"></select></label>
        <label class="field">Manette<select id="padSelect"><option value="">Aucune manette</option></select></label>
      </div>
      <div class="header-actions">
        <button id="openMashTestBtn" class="btn-highlight" title="Teste chaque bouton avec des appuis rapides et réguliers pour repérer les doubles déclenchements involontaires">Diagnostic des boutons</button>
        <button id="exportReportBtn" title="Exporte un rapport de diagnostic en PDF avec l'état actuel de la manette">Exporter rapport (PDF)</button>
        <button id="resetDataBtn" class="danger" title="Réinitialise les calibrations, le drift, les mesures de gâchettes, les boutons et l'historique">Réinitialiser les données</button>
      </div>
    </div>
  </header>

  <div class="empty-state" id="emptyState">
    <div class="empty-state-pulse"></div>
    <h2>En attente d'une manette</h2>
    <p>Branchez une manette filaire ou appairez-la en Bluetooth, puis appuyez sur un bouton pour la réveiller.</p>
  </div>

  <section class="guide-shell" id="guideShell" aria-labelledby="guideTitle">
    <div class="mode-switch" role="group" aria-label="Mode d'affichage">
      <button class="mode-switch-button active" type="button" data-app-mode="guided" aria-pressed="true">Diagnostic guidé</button>
      <button class="mode-switch-button" type="button" data-app-mode="lab" aria-pressed="false">Mode laboratoire</button>
    </div>
    <div class="guide-main">
      <div class="guide-copy">
        <span class="guide-kicker" id="guideKicker">Étape 1 sur 5 · Connexion</span>
        <h2 id="guideTitle">Vérifiez d'abord la manette détectée</h2>
        <p id="guideDescription">L'application commence par vérifier l'identité, le mapping et les capacités exposées par le navigateur.</p>
      </div>
      <div class="guide-progress" id="guideProgressLabel">Connexion en attente</div>
    </div>
    <nav class="guide-steps" aria-label="Étapes du diagnostic">
      <button type="button" data-guide-target="overview" class="active" aria-current="step"><span>1</span>Connexion</button>
      <button type="button" data-guide-target="sticks"><span>2</span>Sticks</button>
      <button type="button" data-guide-target="triggers"><span>3</span>Gâchettes</button>
      <button type="button" data-guide-target="buttons"><span>4</span>Boutons</button>
      <button type="button" data-guide-target="summary"><span>5</span>Résultats</button>
    </nav>
    <section class="guide-now" id="guideNow" aria-labelledby="guideNowTitle">
      <div class="guide-now-copy">
        <span class="guide-now-kicker">À faire maintenant</span>
        <h3 id="guideNowTitle">Vérifiez la manette reconnue</h3>
        <p id="guideNowDescription">Confirmez que le nom et le nombre de commandes correspondent à votre manette.</p>
      </div>
      <ol class="guide-task-list" id="guideTaskList"></ol>
    </section>
    <div class="guide-actions">
      <button type="button" id="guidePrevBtn" disabled>Étape précédente</button>
      <button type="button" id="guideContextAction" class="guide-context-action hidden"></button>
      <button type="button" id="guideSkipBtn" class="guide-skip hidden">Passer cette étape</button>
      <button type="button" id="guideNextBtn" class="btn-highlight">Continuer vers les sticks</button>
    </div>
  </section>

  <div class="grid" id="grid">
    <section class="panel device-panel span-2" data-guide-section="overview">
      <div class="device-panel-copy">
        <span class="panel-kicker">Contrôle de compatibilité</span>
        <h2>Manette détectée</h2>
        <strong id="deviceName">Aucune manette</strong>
        <p id="deviceMapping">Connectez une manette pour vérifier son mapping.</p>
        <div class="device-facts">
          <span id="deviceButtons">— boutons</span>
          <span id="deviceAxes">— axes</span>
          <span id="deviceSupport">Compatibilité inconnue</span>
        </div>
      </div>
      <div class="device-visual" id="silhouetteContainer"></div>
    </section>

    <section class="panel stick-panel stick-panel--left" data-guide-section="sticks">
      <h2>Joystick gauche</h2>
      <div class="stick-row">
        <canvas class="stick" id="leftCanvas" width="180" height="180" aria-label="Position du joystick gauche"></canvas>
        <div class="sliders" style="flex:1">
          <label for="leftInner">Zone morte intérieure : <span class="mono" id="leftInnerVal"></span></label>
          <input type="range" id="leftInner" min="0" max="0.9" step="0.01" value="0.1" />
          <label for="leftOuter">Zone morte extérieure : <span class="mono" id="leftOuterVal"></span></label>
          <input type="range" id="leftOuter" min="0.1" max="1" step="0.01" value="0.95" />
          <div class="coord">
            Brut: <b class="mono" id="leftRaw">0.00, 0.00</b><br/>
            Ajusté: <b class="mono" id="leftAdj">0.00, 0.00</b>
          </div>
          <div class="calib-actions">
            <button id="leftCalibBtn">Tester l'amplitude du stick</button>
            <button id="leftCalibReset" class="danger">Réinitialiser</button>
          </div>
          <p class="note" id="leftCalibResult"></p>
          <p class="note" id="leftNeutralResult">Point neutre : non testé</p>
        </div>
      </div>
    </section>

    <section class="panel stick-panel stick-panel--right" data-guide-section="sticks">
      <h2>Joystick droit</h2>
      <div class="stick-row">
        <canvas class="stick" id="rightCanvas" width="180" height="180" aria-label="Position du joystick droit"></canvas>
        <div class="sliders" style="flex:1">
          <label for="rightInner">Zone morte intérieure : <span class="mono" id="rightInnerVal"></span></label>
          <input type="range" id="rightInner" min="0" max="0.9" step="0.01" value="0.1" />
          <label for="rightOuter">Zone morte extérieure : <span class="mono" id="rightOuterVal"></span></label>
          <input type="range" id="rightOuter" min="0.1" max="1" step="0.01" value="0.95" />
          <div class="coord">
            Brut: <b class="mono" id="rightRaw">0.00, 0.00</b><br/>
            Ajusté: <b class="mono" id="rightAdj">0.00, 0.00</b>
          </div>
          <div class="calib-actions">
            <button id="rightCalibBtn">Tester l'amplitude du stick</button>
            <button id="rightCalibReset" class="danger">Réinitialiser</button>
          </div>
          <p class="note" id="rightCalibResult"></p>
          <p class="note" id="rightNeutralResult">Point neutre : non testé</p>
        </div>
      </div>
    </section>

    <section class="panel neutral-panel span-2" id="neutralPanel" data-guide-section="sticks">
      <div class="panel-heading-row">
        <div>
          <span class="panel-kicker">Mesure guidée</span>
          <h2>Point neutre et stabilité des sticks</h2>
        </div>
        <button type="button" id="measureNeutralBtn">Mesurer le point neutre</button>
      </div>
      <p class="measurement-instruction" id="neutralCaptureStatus">Posez la manette à plat, relâchez les sticks, puis lancez une mesure de trois secondes.</p>
      <p class="note" style="margin:0 0 6px">Gauche</p>
      <canvas class="graph" id="driftGraphLeft" width="1200" height="70" aria-label="Stabilité horizontale du joystick gauche"></canvas>
      <p class="note" style="margin:14px 0 6px">Droit</p>
      <canvas class="graph" id="driftGraphRight" width="1200" height="70" aria-label="Stabilité horizontale du joystick droit"></canvas>
      <p class="note">Ces courbes montrent la stabilité pendant la mesure. Un résultat n'est validé que si la manette reste immobile.</p>
    </section>

    <section class="panel panel--trigger-vibration span-2" data-guide-section="triggers">
      <h2>Gâchettes &amp; vibration</h2>
      <p class="measurement-instruction">Maintenez chaque gâchette à mi-course pendant cinq secondes. La mesure décrit la régularité du signal, sans prétendre certifier l'état mécanique du capteur.</p>
      <div class="trigger-gauges">
        <div class="trigger-gauge">
          <div class="trigger-label"><span>LT</span><span class="mono" id="ltVal">0%</span></div>
          <div class="trigger-bar-bg trigger-bar-bg--thick"><div class="trigger-bar-fill" id="ltBar"></div></div>
          <p class="note" id="ltStabilityResult" title="Maintenez la gâchette à mi-course pour observer la régularité du signal exposé par le navigateur.">Stabilité : maintenez à mi-course pour mesurer...</p>
        </div>
        <div class="trigger-gauge">
          <div class="trigger-label"><span>RT</span><span class="mono" id="rtVal">0%</span></div>
          <div class="trigger-bar-bg trigger-bar-bg--thick"><div class="trigger-bar-fill" id="rtBar"></div></div>
          <p class="note" id="rtStabilityResult" title="Maintenez la gâchette à mi-course pour observer la régularité du signal exposé par le navigateur.">Stabilité : maintenez à mi-course pour mesurer...</p>
        </div>
      </div>

      <p class="note" style="margin:0 0 6px">Historique des gâchettes (<span class="legend-dot legend-dot--accent"></span> LT, <span class="legend-dot legend-dot--accent-alt"></span> RT)</p>
      <canvas class="graph" id="triggerHistoryGraph" width="1200" height="70"></canvas>
      <p class="note">Un tracé irrégulier mérite une seconde mesure dans les mêmes conditions avant toute conclusion sur le capteur.</p>

      <div class="vib-section">
        <div class="vib-section-head">
          <h3>Vibrations</h3>
          <span class="vib-status" id="vibStatus">Aucune manette</span>
        </div>

        <div class="motor-cards">
          <div class="motor-card" id="motorCardStrong">
            <div class="motor-card-head"><span>Moteur gauche</span><span class="note">basse fréq. / grave</span></div>
            <label class="sr-only" for="vibStrongLive">Intensité continue du moteur gauche</label>
            <input type="range" id="vibStrongLive" min="0" max="1" step="0.01" value="0" />
            <div class="motor-card-foot">
              <span class="mono" id="vibStrongLiveVal">0%</span>
              <button id="vibStrongTest">Tester 600 ms</button>
            </div>
          </div>
          <div class="motor-card" id="motorCardWeak">
            <div class="motor-card-head"><span>Moteur droit</span><span class="note">haute fréq. / aiguë</span></div>
            <label class="sr-only" for="vibWeakLive">Intensité continue du moteur droit</label>
            <input type="range" id="vibWeakLive" min="0" max="1" step="0.01" value="0" />
            <div class="motor-card-foot">
              <span class="mono" id="vibWeakLiveVal">0%</span>
              <button id="vibWeakTest">Tester 600 ms</button>
            </div>
          </div>
        </div>

        <div class="vib-presets">
          <button id="presetLight">Légère</button>
          <button id="presetBalanced">Équilibrée</button>
          <button id="presetIntense">Intense</button>
          <button id="vibStop" class="danger hidden">Tout arrêter</button>
        </div>
        <div class="vib-footnotes">
          <p class="note">L'application peut envoyer une commande de vibration, mais elle ne peut pas mesurer la force réelle des moteurs. Confirmez le résultat selon ce que vous ressentez.</p>
          <p class="note" id="vibNote"></p>
        </div>
      </div>
    </section>

    <section class="panel span-2" data-guide-section="buttons">
      <h2>Boutons <span class="note" style="display:inline">(doubles déclenchements détectés : <span id="chatterCount" class="value mono" style="color:var(--accent-alt)">0</span>)</span></h2>
      <div class="buttons-grid" id="buttonsGrid"></div>
      <p class="note">Un double déclenchement involontaire, aussi appelé chatter, est signalé lorsqu'un bouton se relâche puis se réenfonce en moins de 60 ms. Un événement isolé doit toujours être confirmé par le diagnostic guidé.</p>
    </section>

    <section class="panel span-2 press-history-panel" data-guide-section="buttons">
      <h2>Historique des appuis</h2>
      <div class="press-log-frame">
        <div class="press-log-columns" aria-hidden="true">
          <span>Heure</span>
          <span>Bouton</span>
          <span class="press-log-heading-value">Valeur</span>
          <span class="press-log-heading-interval">Depuis précédent</span>
          <span>Diagnostic</span>
        </div>
        <div id="pressLog" class="press-log" role="log" aria-live="polite" aria-label="Historique des dix derniers appuis"></div>
      </div>
      <p class="note">Les dix derniers appuis sont conservés pour repérer les doubles déclenchements et vérifier le déroulement du test.</p>
    </section>

    <section class="panel span-2 results-panel" data-guide-section="summary">
      <div class="results-heading">
        <div>
          <span class="panel-kicker">Synthèse traçable</span>
          <h2>Résultats du diagnostic</h2>
        </div>
        <span class="confidence-chip" id="summaryConfidence">Diagnostic incomplet</span>
      </div>
      <p class="measurement-instruction" id="summaryLead">Les résultats distinguent les mesures validées, les points à confirmer et les tests non réalisés.</p>
      <div class="results-grid" id="summaryResults" aria-live="polite"></div>
    </section>
  </div>

  <footer class="app-footer">
    Fait par <a href="https://github.com/SekaPsyka" target="_blank" rel="noopener noreferrer">SekaPsyka</a> ·
    <a href="https://github.com/SekaPsyka/GamepadTester" target="_blank" rel="noopener noreferrer">Code source sur GitHub</a>
  </footer>

  <div class="mash-overlay" id="mashOverlay" role="dialog" aria-modal="true" aria-labelledby="mashDialogTitle" aria-hidden="true">
    <div class="mash-panel" tabindex="-1">
      <div id="mashSetup">
        <h2 id="mashDialogTitle">Diagnostic des boutons</h2>
        <p class="note">Préparez-vous avant de commencer : le test passera ensuite automatiquement d'un bouton au suivant. Le bouton système Guide/PS est volontairement exclu.</p>
        <div class="mash-optimal-conditions">
          <h3>Pour un résultat fiable</h3>
          <ul>
            <li>Appuyez à un rythme <strong>rapide, net et régulier</strong>, en relâchant bien chaque bouton entre deux appuis.</li>
            <li>Visez <strong>au moins 20 appuis</strong> par bouton sur la durée du test: en dessous, le résultat est jugé pas assez fiable pour conclure (affiché "N/A").</li>
            <li>Gardez cet onglet visible jusqu'à la fin du diagnostic.</li>
          </ul>
          <details>
            <summary>Conseils supplémentaires</summary>
            <ul>
              <li>Utilisez une batterie ou des piles suffisamment chargées.</li>
              <li>Privilégiez une connexion filaire ; en sans-fil, restez proche du récepteur.</li>
              <li>Fermez les autres applications susceptibles d'utiliser la manette.</li>
            </ul>
          </details>
        </div>
        <p class="note" id="mashSetupWarning"></p>
        <label class="field">Durée par bouton
          <select id="mashDuration">
            <option value="5000">5 secondes</option>
            <option value="10000">10 secondes</option>
          </select>
        </label>
        <p class="mash-estimate" id="mashEstimate"></p>
        <div class="mash-actions">
          <button id="mashStartBtn" class="btn-highlight">Commencer le test</button>
          <button id="mashCancelSetupBtn" class="danger">Annuler</button>
        </div>
      </div>
      <div id="mashRunning" class="hidden">
        <p class="note" id="mashProgress"></p>
        <h2 id="mashCurrentLabel"></h2>
        <div class="mash-timer-bar-bg"><div class="mash-timer-bar-fill" id="mashTimerFill"></div></div>
        <div class="mash-count" id="mashCount">0</div>
        <p class="note">appuis</p>
        <div class="mash-actions">
          <button id="mashAbortBtn" class="danger">Arrêter le test</button>
        </div>
      </div>
      <div id="mashSummary" class="hidden">
        <h2>Résultat du diagnostic des boutons</h2>
        <div id="mashSummaryTable"></div>
        <div class="mash-actions">
          <button id="mashRetestBtn">Refaire le test</button>
          <button id="mashCloseBtn">Fermer</button>
        </div>
      </div>
    </div>
  </div>
`;

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
const guidePrevBtn = document.getElementById("guidePrevBtn");
const guideNextBtn = document.getElementById("guideNextBtn");
const guideSkipBtn = document.getElementById("guideSkipBtn");
const guideContextAction = document.getElementById("guideContextAction");
const guideStepButtons = [...document.querySelectorAll("[data-guide-target]")];
const modeButtons = [...document.querySelectorAll("[data-app-mode]")];
const guideSections = [...document.querySelectorAll("[data-guide-section]")];
const exportReportBtn = document.getElementById("exportReportBtn");
const openMashTestBtn = document.getElementById("openMashTestBtn");

const GUIDE_STEPS = [
  {
    id: "overview",
    label: "Connexion",
    title: "Vérifiez d'abord la manette détectée",
    description: "L'application contrôle l'identité, le mapping et les capacités réellement exposées par le navigateur.",
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
const skippedGuideSteps = new Set();

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
      active: Boolean(neutralCapture),
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
    mashCompleted: Boolean(lastMashResults),
    skippedSteps: [...skippedGuideSteps],
  });
}

function taskInstruction(stepId, taskId) {
  const instructions = {
    connection: ["Vérifiez la manette reconnue", "Confirmez que le nom, le nombre de boutons et le nombre d'axes correspondent à votre manette."],
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
  if (stepId === "summary") return { label: "Exporter le rapport PDF", run: () => exportReportBtn.click() };
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
  const hasBad = items.some((item) => item.status === "bad");
  const hasWarn = items.some((item) => item.status === "warn");
  const hasUntested = items.some((item) => item.status === "neutral");

  const summaryState = hasBad
    ? { status: "bad", label: "Problème probable", lead: "Au moins un résultat mérite une vérification matérielle ou un nouveau test." }
    : hasWarn
      ? { status: "warn", label: "Points à confirmer", lead: "Certaines mesures sont atypiques ou demandent une seconde tentative." }
      : hasUntested
        ? { status: "neutral", label: "Diagnostic incomplet", lead: "Terminez les tests indiqués comme non réalisés avant de conclure." }
        : { status: "ok", label: "Mesures cohérentes", lead: "Aucun problème n'a été détecté dans les tests réalisés dans de bonnes conditions." };

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
    ? stepState.state === "complete" ? "Connexion vérifiée" : "Connexion en attente"
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
  guideSkipBtn.classList.toggle("hidden", !isPadConnected || !["sticks", "triggers", "buttons"].includes(step.id) || canContinue);

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
const vibrationCommands = { strong: "pending", weak: "pending" };

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

const calibration = {
  left: { active: false, completed: false, points: [] },
  right: { active: false, completed: false, points: [] },
};
const calibrationControls = {};

// Analyse le tracé d'un stick par secteurs angulaires plutôt que par une simple rondeur globale.
// De nombreux sticks (notamment Xbox) ont un guide mécanique carré/octogonal: le rayon
// varie naturellement selon la direction (souvent plus grand en diagonale qu'à l'horizontale/verticale),
// mais ce profil reste symétrique. Une vraie anomalie (usure, drift localisé) se traduit par une
// asymétrie entre deux directions opposées, pas par un simple écart à un cercle parfait.
const SECTOR_COUNT = 16;

function analyzeRange(points) {
  if (points.length < 5) return "Pas assez de données, réessayez.";

  // On prend le rayon MAX atteint par secteur angulaire: les points de repos (proches du
  // centre) ne peuvent jamais devenir ce maximum, donc pas besoin de les filtrer en amont,
  // et surtout, ça évite d'effacer par erreur une vraie zone de rayon réduit (usure/drift).
  const sectorMax = new Array(SECTOR_COUNT).fill(0);
  for (const p of points) {
    const angle = Math.atan2(p.y, p.x);
    const normalized = ((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
    const sector = Math.min(SECTOR_COUNT - 1, Math.floor(normalized * SECTOR_COUNT));
    const r = Math.hypot(p.x, p.y);
    if (r > sectorMax[sector]) sectorMax[sector] = r;
  }

  const filledSectors = sectorMax.filter((r) => r > 0).length;
  if (filledSectors < SECTOR_COUNT * 0.75) {
    return "Tracé incomplet, faites un tour à 360° plus régulier pour une analyse fiable.";
  }

  let maxAsymmetry = 0;
  let worstPair = null;
  for (let i = 0; i < SECTOR_COUNT / 2; i++) {
    const opposite = i + SECTOR_COUNT / 2;
    const a = sectorMax[i];
    const b = sectorMax[opposite];
    if (a === 0 || b === 0) continue;
    const asymmetry = Math.abs(a - b) / Math.max(a, b);
    if (asymmetry > maxAsymmetry) {
      maxAsymmetry = asymmetry;
      worstPair = [i, opposite];
    }
  }

  const globalMin = Math.min(...sectorMax.filter((r) => r > 0));
  const globalMax = Math.max(...sectorMax);
  const roundness = (globalMin / globalMax) * 100;

  if (maxAsymmetry < 0.18) {
    return `Forme symétrique (rondeur globale: ${roundness.toFixed(0)}%), une forme carrée/octogonale est normale sur de nombreux sticks (guide mécanique), aucune anomalie détectée ✓`;
  }

  const angleDeg = Math.round((worstPair[0] / SECTOR_COUNT) * 360);
  return `Asymétrie détectée (${(maxAsymmetry * 100).toFixed(0)}%) autour de ${angleDeg}°, une direction atteint un rayon nettement plus court que son opposée, ce qui peut indiquer une usure ou un stick drift localisé plutôt qu'un simple guide carré.`;
}

function setupCalibration(side, buttonId, resultId, resetId) {
  const btn = document.getElementById(buttonId);
  const resultEl = document.getElementById(resultId);
  const resetBtn = document.getElementById(resetId);
  const state = calibration[side];

  calibrationControls[side] = { btn, resultEl };
  btn.addEventListener("click", () => toggleCalibration(side));

  resetBtn.addEventListener("click", () => {
    state.active = false;
    state.completed = false;
    state.points = [];
    btn.textContent = "Tester l'amplitude du stick";
    resultEl.textContent = "";
    renderGuide();
  });
}

function toggleCalibration(side) {
  const state = calibration[side];
  const { btn, resultEl } = calibrationControls[side];
  skippedGuideSteps.delete("sticks");
  if (!state.active) {
    state.active = true;
    state.completed = false;
    state.points = [];
    btn.textContent = "Arrêter & afficher le résultat";
    resultEl.textContent = "Calibration en cours, faites le tour complet du stick...";
  } else {
    state.active = false;
    btn.textContent = "Tester l'amplitude du stick";
    if (state.points.length < 5) {
      state.completed = false;
      resultEl.textContent = "Pas assez de données, réessayez.";
      renderGuide();
      return;
    }
    state.completed = true;
    resultEl.textContent = analyzeRange(state.points);
  }
  renderGuide();
}
setupCalibration("left", "leftCalibBtn", "leftCalibResult", "leftCalibReset");
setupCalibration("right", "rightCalibBtn", "rightCalibResult", "rightCalibReset");

const neutralDrift = {
  left: new NeutralDriftTracker(),
  right: new NeutralDriftTracker(),
};
const neutralResultEls = {
  left: document.getElementById("leftNeutralResult"),
  right: document.getElementById("rightNeutralResult"),
};
const neutralCaptureStatus = document.getElementById("neutralCaptureStatus");
const measureNeutralBtn = document.getElementById("measureNeutralBtn");
const NEUTRAL_CAPTURE_DURATION_MS = 3000;
let neutralCapture = null;

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
  const invalid = neutralCapture.maxFrameGapMs > 100 || !left.measured || !right.measured;
  neutralCapture = null;
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
  if (!neutralCapture) return;
  neutralCapture.maxFrameGapMs = Math.max(neutralCapture.maxFrameGapMs, frameGapMs);
  neutralDrift.left.update(lx, ly, now);
  neutralDrift.right.update(rx, ry, now);
  const remainingMs = Math.max(0, neutralCapture.endAt - now);
  const remainingSeconds = (remainingMs / 1000).toFixed(1);
  neutralCaptureStatus.textContent = `Mesure en cours : ne touchez pas à la manette pendant encore ${remainingSeconds} s.`;
  neutralCaptureStatus.dataset.status = "active";
  measureNeutralBtn.textContent = `${remainingSeconds} s`;
  renderNeutralDrift("left");
  renderNeutralDrift("right");
  if (remainingMs <= 0) finishNeutralCapture();
}

function startNeutralCapture() {
  if (!getSelectedGamepad() || neutralCapture) return;
  skippedGuideSteps.delete("sticks");
  neutralDrift.left.reset();
  neutralDrift.right.reset();
  const now = performance.now();
  neutralCapture = { endAt: now + NEUTRAL_CAPTURE_DURATION_MS, maxFrameGapMs: 0 };
  measureNeutralBtn.disabled = true;
  guideContextAction.disabled = true;
  neutralCaptureStatus.textContent = "Mesure en cours : ne touchez plus à la manette.";
  neutralCaptureStatus.dataset.status = "active";
  renderGuide();
}

measureNeutralBtn.addEventListener("click", startNeutralCapture);

const triggerStability = {
  lt: new TriggerStabilityTracker(),
  rt: new TriggerStabilityTracker(),
};
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
let lastMashResults = null;
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
  overall.textContent = `Fiabilité globale: ${overallGrade.label} (${totalChatter} chatter sur ${totalPressCount} appuis)`;
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
  if (lastMashResults) {
    renderMashSummaryTable(lastMashResults);
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
  lastMashResults = null;
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
let lastLoggedPressAt = null;

function logPress(label, { value, eventTime, chatterDelayMs = null }) {
  const entry = document.createElement("div");
  const time = new Date().toLocaleTimeString("fr-FR", { hour12: false });
  const timeEl = document.createElement("time");
  const labelEl = document.createElement("span");
  const valueEl = document.createElement("span");
  const intervalEl = document.createElement("span");
  const statusEl = document.createElement("span");
  const intervalMs = lastLoggedPressAt == null ? null : eventTime - lastLoggedPressAt;
  lastLoggedPressAt = eventTime;

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

let prevButtonStates = [];
let lastReleaseTimes = [];
let lastPadCount = 0;
let lastPadId = null;

let chatterTotal = 0;
const chatterByButton = new Map();
const pressCountByButton = new Map();
const chatterCountEl = document.getElementById("chatterCount");

function buildDiagnosticReport() {
  const pad = getSelectedGamepad();
  return {
    generatedAt: new Date().toISOString(),
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
    deadzones: {
      left: { inner: Number(sliders.left.inner.value), outer: Number(sliders.left.outer.value) },
      right: { inner: Number(sliders.right.inner.value), outer: Number(sliders.right.outer.value) },
    },
    calibration: {
      left: document.getElementById("leftCalibResult").textContent || null,
      right: document.getElementById("rightCalibResult").textContent || null,
    },
    neutralDrift: {
      left: neutralDrift.left.getOffset(),
      right: neutralDrift.right.getOffset(),
    },
    triggerStability: {
      lt: triggerStability.lt.getResult(),
      rt: triggerStability.rt.getResult(),
    },
    vibration: {
      supported: Boolean(pad?.vibrationActuator),
      commands: { ...vibrationCommands },
    },
    guide: {
      skippedSteps: [...skippedGuideSteps],
    },
    chatterEventsTotal: chatterTotal,
    totalPressCount: [...pressCountByButton.values()].reduce((sum, n) => sum + n, 0),
    chatterByButton: [...chatterByButton.entries()]
      .map(([label, count]) => ({ label, count, pressCount: pressCountByButton.get(label) || count }))
      .sort((a, b) => b.count - a.count),
    mashTest: lastMashResults
      ? lastMashResults.map((r) => ({
          label: r.label,
          pressCount: r.pressCount,
          pressesPerSecond: Number(r.pressesPerSecond.toFixed(1)),
          chatterCount: r.chatterCount,
          reliable: r.reliable,
          maxStallGapMs: r.maxStallGapMs,
        }))
      : null,
  };
}

// Le seuil "bad" (35%) est environ le double du seuil de détection (18% dans analyzeRange):
// une asymétrie franchement au-dessus du bruit de mesure plutôt qu'un cas limite.
const ASYMMETRY_BAD_THRESHOLD_PERCENT = 35;

function asymmetryPercent(calibrationText) {
  if (typeof calibrationText !== "string") return null;
  const match = calibrationText.match(/^Asymétrie détectée \((\d+)%\)/);
  return match ? Number(match[1]) : null;
}

function computeDiagnosticVerdict(report) {
  const items = [];

  if (report.guide?.skippedSteps?.length) {
    const labels = report.guide.skippedSteps.map((id) => GUIDE_STEPS.find((step) => step.id === id)?.label || id);
    items.push({
      status: "neutral",
      title: "Étapes passées",
      text: `${labels.join(", ")} : ces étapes ont été passées volontairement et restent non testées dans cette synthèse.`,
    });
  }

  if (!report.gamepad) {
    items.push({ status: "bad", title: "Manette", text: "Aucune manette connectée au moment de l'export." });
  } else {
    items.push({ status: "ok", title: "Manette", text: `${report.gamepad.id} détectée, ${report.gamepad.buttonCount} boutons, ${report.gamepad.axisCount} axes.` });
  }

  const leftPercent = asymmetryPercent(report.calibration.left);
  const rightPercent = asymmetryPercent(report.calibration.right);
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
  } else {
    items.push({ status: "ok", title: "Sticks", text: "Aucune asymétrie notable observée pendant les tests d'amplitude réalisés." });
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
      text = `${report.chatterEventsTotal} événement(s) détecté(s) sur ${report.totalPressCount} appuis (${globalRate}%), fiabilité ${grade.label.toLowerCase()}.${detail}`;
    }
    items.push({ status: PDF_GRADE_STATUS[grade.key], title: "Observation libre des boutons", text });
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
      text = `Test effectué sur ${report.mashTest.length} bouton(s), aucun double déclenchement observé, fiabilité ${grade.label.toLowerCase()}.`;
    } else {
      const worst = [...report.mashTest].sort((a, b) => b.chatterCount - a.chatterCount)[0];
      text = `Fiabilité ${grade.label.toLowerCase()} (${totalChatter} double(s) déclenchement(s) sur ${totalPressCount} appuis). Bouton le plus touché : ${worst.label} (${worst.chatterCount} fois).`;
    }
    items.push({ status: PDF_GRADE_STATUS[grade.key], title: "Diagnostic des boutons", text });
  }

  return items;
}

const PDF_MARGIN = 15;
const PDF_PAGE_WIDTH = 210;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const PDF_DARK = [30, 32, 40];
const PDF_MUTED = [110, 110, 110];
const PDF_LABEL = [85, 87, 95];
const PDF_HAIRLINE = [188, 191, 199];
const PDF_GRADE_STATUS = { excellent: "ok", good: "ok", fair: "warn", poor: "bad", na: "neutral" };
const PDF_STATUS_COLORS = {
  ok: [30, 150, 90],
  warn: [200, 140, 0],
  bad: [200, 50, 50],
  neutral: [140, 140, 140],
};
const PDF_STATUS_LABELS = { ok: "OK", warn: "ATTENTION", bad: "PROBLÈME", neutral: "N/A" };
// Glyphes ASCII uniquement: les polices de base de jsPDF (WinAnsi) n'incluent pas ✓/✕.
const PDF_STATUS_GLYPHS = { ok: "+", warn: "!", bad: "x", neutral: "-" };

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

// Les couleurs de thème sont des néons saturés (ex: cyan, ambre) qui ne garantissent pas
// un contraste correct avec du texte blanc fixe: on choisit la couleur de texte selon la
// luminance perçue plutôt que de supposer que "couleur vive = texte blanc lisible".
function textColorForBackground([r, g, b]) {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? [20, 20, 25] : [255, 255, 255];
}

function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function pdfEnsureSpace(doc, y, needed) {
  if (y + needed > 278) {
    doc.addPage();
    return 18;
  }
  return y;
}

// En-tête de section "discret": une fine barre d'accent + libellé tracké, plutôt qu'un
// bandeau plein qui donnait le même poids visuel à chaque section du rapport.
function pdfPanelHeader(doc, title, y, accent) {
  y = pdfEnsureSpace(doc, y, 14);
  doc.setFillColor(...accent);
  doc.rect(PDF_MARGIN, y, 1.2, 6, "F");
  doc.setTextColor(...PDF_DARK);
  doc.setFont(undefined, "bold");
  doc.setFontSize(10.5);
  doc.text(title.toUpperCase(), PDF_MARGIN + 4, y + 4.6, { charSpace: 0.3 });
  doc.setFont(undefined, "normal");
  return y + 6 + 6;
}

function pdfDivider(doc, y) {
  doc.setDrawColor(...PDF_HAIRLINE);
  doc.setLineWidth(0.2);
  doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
  return y + 7;
}

// Clin d'œil discret à l'objet du rapport: un badge carré arrondi façon bouton de
// manette, plutôt qu'une simple puce de couleur, pour marquer chaque verdict.
function pdfStatusChip(doc, status, x, y) {
  doc.setFillColor(...PDF_STATUS_COLORS[status]);
  doc.roundedRect(x, y, 4.2, 4.2, 1, 1, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont(undefined, "bold");
  doc.setFontSize(7);
  doc.text(PDF_STATUS_GLYPHS[status], x + 2.1, y + 3, { align: "center" });
}

function pdfVerdictRow(doc, item, y) {
  const lines = doc.splitTextToSize(item.text, PDF_CONTENT_WIDTH - 10);
  y = pdfEnsureSpace(doc, y, lines.length * 4.3 + 7);

  pdfStatusChip(doc, item.status, PDF_MARGIN, y);

  doc.setFont(undefined, "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_DARK);
  doc.text(item.title, PDF_MARGIN + 7, y + 3.2);
  const titleWidth = doc.getTextWidth(item.title);
  doc.setFont(undefined, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_STATUS_COLORS[item.status]);
  doc.text(item.label?.toUpperCase() || PDF_STATUS_LABELS[item.status], PDF_MARGIN + 7 + titleWidth + 3, y + 3.2);
  y += 5.5;

  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  doc.setTextColor(...PDF_DARK);
  doc.text(lines, PDF_MARGIN + 7, y);
  y += lines.length * 4.3 + 4;
  return y;
}

// Carte "instrument": grande valeur en police mono (comme les lectures brutes affichées
// à l'écran dans l'app) + libellé tracké, pour une lecture immédiate sans avoir à lire
// de phrases. Une fine bande de couleur en haut porte le statut (ok/attention/problème).
function pdfKpiCard(doc, x, y, w, h, { label, value, status }) {
  doc.setDrawColor(...PDF_HAIRLINE);
  doc.setLineWidth(0.45);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, "S");
  doc.setFillColor(...PDF_STATUS_COLORS[status]);
  doc.rect(x + 0.6, y, w - 1.2, 1.3, "F");

  doc.setFont("courier", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(...PDF_DARK);
  doc.text(value, x + w / 2, y + h / 2 + 0.5, { align: "center" });

  doc.setFont(undefined, "bold");
  doc.setFontSize(7.2);
  doc.setTextColor(...PDF_LABEL);
  doc.text(label.toUpperCase(), x + w / 2, y + h - 3.2, { align: "center", charSpace: 0.15 });
}

function buildDiagnosticPdf(report) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Couleur d'accent alignée sur le thème actif au moment de l'export, pour que le rapport
  // PDF reste visuellement rattaché à l'application plutôt que d'imposer une charte fixe.
  // Réservée à la couverture, aux libellés de section et aux en-têtes de tableau: les
  // statuts (ok/attention/problème) restent des couleurs sémantiques fixes, jamais teintées.
  const activeTheme = THEMES[getTheme()] || THEMES.cyan;
  const PDF_ACCENT = hexToRgb(activeTheme.accent);
  const PDF_ACCENT_TEXT = textColorForBackground(PDF_ACCENT);

  const titleText = report.gamepad ? `Rapport de diagnostic — ${report.gamepad.id}` : "Rapport de diagnostic manette";
  doc.setFont(undefined, "bold");
  doc.setFontSize(17);
  const titleLines = doc.splitTextToSize(titleText, PDF_CONTENT_WIDTH);
  const coverHeight = 12 + titleLines.length * 7 + 9;
  doc.setFillColor(...PDF_ACCENT);
  doc.rect(0, 0, PDF_PAGE_WIDTH, coverHeight, "F");
  doc.setTextColor(...PDF_ACCENT_TEXT);
  doc.text(titleLines, PDF_MARGIN, 11);
  doc.setFont(undefined, "normal");
  doc.setFontSize(9.5);
  doc.text(`Généré le ${new Date(report.generatedAt).toLocaleString("fr-FR")}`, PDF_MARGIN, 11 + titleLines.length * 7 + 5);
  let y = coverHeight + 10;

  const verdictItems = computeDiagnosticVerdict(report);

  const chatterValue = String(report.chatterEventsTotal);
  const chatterStatus = verdictItems.find((i) => i.title === "Observation libre des boutons" || i.title === "Doubles déclenchements")?.status ?? "neutral";

  let mashValue = "N/A";
  let mashStatus = "neutral";
  if (report.mashTest && report.mashTest.length) {
    const totalPressCount = report.mashTest.reduce((sum, r) => sum + r.pressCount, 0);
    const totalChatter = report.mashTest.reduce((sum, r) => sum + r.chatterCount, 0);
    const overallGrade = gradeForChatter(totalChatter, totalPressCount);
    mashValue = overallGrade.label;
    mashStatus = PDF_GRADE_STATUS[overallGrade.key];
  }

  const hasBadVerdict = verdictItems.some((i) => i.status === "bad");
  const hasWarnVerdict = verdictItems.some((i) => i.status === "warn");
  const hasNeutralVerdict = verdictItems.some((i) => i.status === "neutral");
  const globalStatus = hasBadVerdict ? "bad" : hasWarnVerdict ? "warn" : hasNeutralVerdict ? "neutral" : "ok";
  const globalValue = hasBadVerdict ? "Problème" : hasWarnVerdict ? "Attention" : hasNeutralVerdict ? "Incomplet" : "Cohérent";
  const measuredItems = verdictItems.filter((item) => item.status !== "neutral").length;

  y = pdfEnsureSpace(doc, y, 26);
  const kpis = [
    { label: "Mesures disponibles", value: `${measuredItems}/${verdictItems.length}`, status: hasNeutralVerdict ? "neutral" : "ok" },
    { label: "Doubles déclenchements", value: chatterValue, status: chatterStatus },
    { label: "Fiabilité boutons", value: mashValue, status: mashStatus },
    { label: "Synthèse", value: globalValue, status: globalStatus },
  ];
  const kpiGap = 4;
  const kpiWidth = (PDF_CONTENT_WIDTH - kpiGap * (kpis.length - 1)) / kpis.length;
  const kpiHeight = 22;
  kpis.forEach((kpi, i) => pdfKpiCard(doc, PDF_MARGIN + i * (kpiWidth + kpiGap), y, kpiWidth, kpiHeight, kpi));
  y += kpiHeight + 10;

  y = pdfEnsureSpace(doc, y, 24);
  y = pdfPanelHeader(doc, "Résumé du diagnostic", y, PDF_ACCENT);
  for (const item of verdictItems) {
    y = pdfVerdictRow(doc, item, y);
  }
  y = pdfDivider(doc, y + 2);

  y = pdfEnsureSpace(doc, y, 36);
  y = pdfPanelHeader(doc, "Manette & zones mortes", y, PDF_ACCENT);
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_DARK);
  if (report.gamepad) {
    doc.setFont(undefined, "bold");
    doc.text("Nom", PDF_MARGIN + 2, y);
    doc.setFont(undefined, "normal");
    doc.text(report.gamepad.id, PDF_MARGIN + 18, y);
    y += 5.5;
    doc.setFont(undefined, "bold");
    doc.text("Mapping", PDF_MARGIN + 2, y);
    doc.setFont(undefined, "normal");
    doc.text(
      `${report.gamepad.mapping} · ${report.gamepad.buttonCount} boutons · ${report.gamepad.axisCount} axes`,
      PDF_MARGIN + 18,
      y
    );
    y += 7;
  } else {
    doc.text("Aucune manette connectée au moment de l'export.", PDF_MARGIN + 2, y);
    y += 7;
  }
  autoTable(doc, {
    startY: y,
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    head: [["Stick", "Zone morte intérieure", "Zone morte extérieure"]],
    body: [
      ["Gauche", report.deadzones.left.inner.toFixed(2), report.deadzones.left.outer.toFixed(2)],
      ["Droit", report.deadzones.right.inner.toFixed(2), report.deadzones.right.outer.toFixed(2)],
    ],
    theme: "grid",
    headStyles: { fillColor: PDF_ACCENT, textColor: PDF_ACCENT_TEXT, fontSize: 9 },
    styles: { fontSize: 9.5, textColor: PDF_DARK },
    columnStyles: {
      1: { font: "courier", halign: "right" },
      2: { font: "courier", halign: "right" },
    },
  });
  y = pdfDivider(doc, doc.lastAutoTable.finalY + 8);

  y = pdfEnsureSpace(doc, y, 52);
  y = pdfPanelHeader(doc, "Sticks — calibration & point neutre", y, PDF_ACCENT);
  const colGap = 6;
  const colWidth = (PDF_CONTENT_WIDTH - colGap) / 2;
  const sides = [
    { key: "left", label: "Gauche", x: PDF_MARGIN },
    { key: "right", label: "Droit", x: PDF_MARGIN + colWidth + colGap },
  ];
  const sticksStartY = y;
  let sticksEndY = y;
  for (const side of sides) {
    let cy = sticksStartY;
    doc.setFont(undefined, "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_DARK);
    doc.text(side.label.toUpperCase(), side.x, cy, { charSpace: 0.2 });
    cy += 5;

    doc.setFont(undefined, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_DARK);
    const calibText = report.calibration[side.key] || "Aucune calibration effectuée.";
    const calibLines = doc.splitTextToSize(calibText, colWidth);
    doc.text(calibLines, side.x, cy);
    cy += calibLines.length * 4 + 4;

    const offset = report.neutralDrift[side.key];
    const drifted = offset.measured && offset.magnitude > NEUTRAL_DRIFT_WARN_THRESHOLD;
    const neutralText = offset.measured
      ? `Point neutre: ${offset.x.toFixed(3)}, ${offset.y.toFixed(3)} ${drifted ? "(décalé)" : "(centré)"}`
      : "Point neutre: pas encore mesuré.";
    const neutralLines = doc.splitTextToSize(neutralText, colWidth);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...(drifted ? PDF_STATUS_COLORS.warn : PDF_MUTED));
    doc.text(neutralLines, side.x, cy);
    cy += neutralLines.length * 4 + 2;

    sticksEndY = Math.max(sticksEndY, cy);
  }
  doc.setFont(undefined, "normal");
  y = pdfDivider(doc, sticksEndY + 3);

  y = pdfEnsureSpace(doc, y, 36);
  y = pdfPanelHeader(doc, "Gâchettes — stabilité du signal", y, PDF_ACCENT);
  const triggerSides = [
    { key: "lt", label: "LT / L2", x: PDF_MARGIN },
    { key: "rt", label: "RT / R2", x: PDF_MARGIN + colWidth + colGap },
  ];
  const triggersStartY = y;
  let triggersEndY = y;
  for (const side of triggerSides) {
    let cy = triggersStartY;
    doc.setFont(undefined, "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_DARK);
    doc.text(side.label.toUpperCase(), side.x, cy, { charSpace: 0.2 });
    cy += 5;

    const result = report.triggerStability[side.key];
    const grade = triggerStabilityGrade(result);
    const qualifier =
      grade.key === "poor" ? "(instable)" : grade.key === "fair" ? (grade.isolated ? "(écart isolé, à confirmer)" : "(léger bruit)") : "(lisse)";
    const stabilityText = result.measured
      ? `Écart à palier tenu: ${(result.range * 100).toFixed(1)}% (${result.stepCount} saut(s)) ${qualifier}`
      : "Pas encore mesuré (maintenez à mi-course).";
    const stabilityLines = doc.splitTextToSize(stabilityText, colWidth);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...(grade.key === "poor" ? PDF_STATUS_COLORS.bad : grade.key === "fair" ? PDF_STATUS_COLORS.warn : PDF_MUTED));
    doc.text(stabilityLines, side.x, cy);
    cy += stabilityLines.length * 4 + 2;

    triggersEndY = Math.max(triggersEndY, cy);
  }
  doc.setFont(undefined, "normal");
  const vibrationText = !report.vibration?.supported
    ? "Vibrations : non applicables avec cette manette ou ce navigateur."
    : report.vibration.commands.strong === "complete" && report.vibration.commands.weak === "complete"
      ? "Commandes de vibration envoyées aux deux moteurs à 100 % pendant 600 ms. La force réellement produite n'est pas mesurable par l'application."
      : "Commandes de vibration incomplètes ou interrompues ; aucune conclusion matérielle n'est possible.";
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_MUTED);
  const vibrationLines = doc.splitTextToSize(vibrationText, PDF_CONTENT_WIDTH - 4);
  doc.text(vibrationLines, PDF_MARGIN + 2, triggersEndY + 3);
  y = pdfDivider(doc, triggersEndY + 4 + vibrationLines.length * 4);

  y = pdfEnsureSpace(doc, y, 32);
  y = pdfPanelHeader(doc, "Doubles déclenchements observés", y, PDF_ACCENT);
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_DARK);
  doc.setFont(undefined, "bold");
  doc.text("Événements détectés", PDF_MARGIN + 2, y);
  doc.setFont("courier", "normal");
  doc.text(`${report.chatterEventsTotal} événement(s)`, PDF_MARGIN + 40, y);
  doc.setFont(undefined, "normal");
  y += 8;

  if (report.chatterByButton.length > 0) {
    y = pdfEnsureSpace(doc, y, 16);
    autoTable(doc, {
      startY: y,
      margin: { left: PDF_MARGIN, right: PDF_MARGIN },
      head: [["Bouton", "Appuis", "Chatter", "Taux"]],
      body: report.chatterByButton.map((b) => [
        b.label,
        String(b.pressCount),
        String(b.count),
        `${Math.round((b.count / b.pressCount) * 100)}%`,
      ]),
      theme: "grid",
      headStyles: { fillColor: PDF_DARK, textColor: 255, fontSize: 9 },
      styles: { fontSize: 9, textColor: PDF_DARK },
      columnStyles: {
        1: { font: "courier", halign: "right" },
        2: { font: "courier", halign: "right" },
        3: { font: "courier", halign: "right" },
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  } else {
    y += 2;
  }
  y = pdfDivider(doc, y);

  y = pdfEnsureSpace(doc, y, 30);
  y = pdfPanelHeader(doc, "Diagnostic guidé des boutons", y, PDF_ACCENT);
  if (report.mashTest && report.mashTest.length) {
    const totalPressCount = report.mashTest.reduce((sum, r) => sum + r.pressCount, 0);
    const totalChatter = report.mashTest.reduce((sum, r) => sum + r.chatterCount, 0);
    const overallGrade = gradeForChatter(totalChatter, totalPressCount);
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_STATUS_COLORS[PDF_GRADE_STATUS[overallGrade.key]]);
    doc.setFont(undefined, "bold");
    doc.text(`Fiabilité globale: ${overallGrade.label} (${totalChatter} chatter sur ${totalPressCount} appuis)`, PDF_MARGIN + 2, y);
    doc.setFont(undefined, "normal");
    y += 7;
    const mashGrades = report.mashTest.map((r) => gradeForChatter(r.chatterCount, r.pressCount));
    const unreliableLabels = report.mashTest.filter((r) => r.reliable === false).map((r) => r.label);
    autoTable(doc, {
      startY: y,
      margin: { left: PDF_MARGIN, right: PDF_MARGIN },
      head: [["Bouton", "Appuis", "Appuis/s", "Doubles", "Fiabilité"]],
      body: report.mashTest.map((r, i) => [
        r.label,
        String(r.pressCount),
        r.pressesPerSecond.toFixed(1),
        String(r.chatterCount),
        r.reliable === false ? `${mashGrades[i].label} (*)` : mashGrades[i].label,
      ]),
      theme: "grid",
      headStyles: { fillColor: PDF_DARK, textColor: 255, fontSize: 9 },
      styles: { fontSize: 9, textColor: PDF_DARK },
      columnStyles: {
        1: { font: "courier", halign: "right" },
        2: { font: "courier", halign: "right" },
        3: { font: "courier", halign: "right" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 4) {
          data.cell.styles.textColor = PDF_STATUS_COLORS[PDF_GRADE_STATUS[mashGrades[data.row.index].key]];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = doc.lastAutoTable.finalY + (unreliableLabels.length ? 5 : 10);
    if (unreliableLabels.length) {
      doc.setFontSize(8);
      doc.setTextColor(...PDF_STATUS_COLORS.warn);
      const warnLines = doc.splitTextToSize(
        `(*) Ralentissement du navigateur détecté pendant le test sur: ${unreliableLabels.join(", ")}, mesure peu fiable pour ce(s) bouton(s), à retester.`,
        PDF_CONTENT_WIDTH - 4,
      );
      doc.text(warnLines, PDF_MARGIN + 2, y);
      y += warnLines.length * 4 + 6;
      doc.setTextColor(...PDF_DARK);
    }
    const verdict = buildMashVerdict(report.mashTest);
    doc.setFontSize(9);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...PDF_STATUS_COLORS[verdict.tone]);
    const verdictLines = doc.splitTextToSize(verdict.text, PDF_CONTENT_WIDTH - 4);
    doc.text(verdictLines, PDF_MARGIN + 2, y);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...PDF_DARK);
    y += verdictLines.length * 4.5 + 8;
  } else {
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_DARK);
    const lines = doc.splitTextToSize(
      "Aucun diagnostic guidé des boutons effectué avant l'export. Lancez ce test depuis l'application pour fiabiliser cette partie du rapport.",
      PDF_CONTENT_WIDTH - 4,
    );
    doc.text(lines, PDF_MARGIN + 2, y);
    y += lines.length * 5 + 6;
  }
  y = pdfDivider(doc, y);

  y = pdfEnsureSpace(doc, y, 28);
  y = pdfPanelHeader(doc, "Limites de ce diagnostic", y, PDF_MUTED);
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_MUTED);
  const limitsLines = doc.splitTextToSize(
    "Ce rapport dépend du navigateur et du système utilisés (fréquence de lecture de la manette, throttling d'un onglet en arrière-plan, pilote...). " +
      "Il donne une bonne indication de l'état de la manette mais ne remplace pas un diagnostic matériel certifié. " +
      "Un résultat isolé sur un seul bouton n'implique pas forcément un défaut, retestez avant de conclure, surtout si le reste du diagnostic est bon.",
    PDF_CONTENT_WIDTH - 4,
  );
  doc.text(limitsLines, PDF_MARGIN + 2, y);

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...PDF_MUTED);
    doc.text("Gamepad Tester", PDF_MARGIN, 291);
    doc.text(`Page ${page} / ${totalPages}`, PDF_PAGE_WIDTH - PDF_MARGIN, 291, { align: "right" });
  }

  return doc;
}

document.getElementById("exportReportBtn").addEventListener("click", () => {
  const report = buildDiagnosticReport();
  const doc = buildDiagnosticPdf(report);
  const padSlug = report.gamepad ? slugify(report.gamepad.id).slice(0, 40) : "sans-manette";
  doc.save(`gamepad-report-${padSlug}-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`);
});

document.getElementById("resetDataBtn").addEventListener("click", () => {
  if (!window.confirm("Réinitialiser toutes les mesures collectées (sticks, gâchettes, boutons et historique) ? Cette action est irréversible.")) {
    return;
  }

  chatterTotal = 0;
  chatterByButton.clear();
  pressCountByButton.clear();
  chatterCountEl.textContent = "0";
  prevButtonStates = [];
  lastReleaseTimes = [];

  driftHistoryLeft.fill(0);
  driftHistoryRight.fill(0);

  pressLog.innerHTML = "";
  lastLoggedPressAt = null;

  mashTest = null;
  lastMashResults = null;
  skippedGuideSteps.clear();
  guideStepIndex = 0;

  document.getElementById("leftCalibReset").click();
  document.getElementById("rightCalibReset").click();

  neutralDrift.left.reset();
  neutralDrift.right.reset();
  neutralCapture = null;
  measureNeutralBtn.disabled = false;
  measureNeutralBtn.textContent = "Mesurer le point neutre";
  guideContextAction.disabled = false;
  neutralCaptureStatus.textContent = "Posez la manette à plat, relâchez les sticks, puis lancez une mesure de trois secondes.";
  delete neutralCaptureStatus.dataset.status;
  renderNeutralDrift("left");
  renderNeutralDrift("right");

  triggerStability.lt.reset();
  triggerStability.rt.reset();
  triggerGuideStates.lt = "idle";
  triggerGuideStates.rt = "idle";
  vibrationCommands.strong = "pending";
  vibrationCommands.weak = "pending";
  renderTriggerStability("lt", performance.now());
  renderTriggerStability("rt", performance.now());
  renderGuide();
});

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
    setConnectedUI(true);
    padName.textContent = pad.id;

    if (pad.id !== lastPadId) {
      lastPadId = pad.id;
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
      prevButtonStates = [];
      lastReleaseTimes = [];
      neutralDrift.left.reset();
      neutralDrift.right.reset();
      triggerStability.lt.reset();
      triggerStability.rt.reset();
      vibrationCommands.strong = "pending";
      vibrationCommands.weak = "pending";
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
        lastMashResults = mashTest.results;
        renderMashSummaryTable(lastMashResults);
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
      const wasPressed = prevButtonStates[i] || false;
      const pressed = isButtonPressed(btn, i, wasPressed);
      if (cell) {
        if (pressed) cell.classList.add("active");
        else cell.classList.remove("active");
      }
      if (pressed && !wasPressed) {
        const label = currentLabels[i] || `Bouton ${i}`;
        pressCountByButton.set(label, (pressCountByButton.get(label) || 0) + 1);
        const sinceRelease = lastReleaseTimes[i];
        if (sinceRelease != null && eventTime - sinceRelease < CHATTER_THRESHOLD_MS) {
          chatterTotal++;
          chatterByButton.set(label, (chatterByButton.get(label) || 0) + 1);
          chatterCountEl.textContent = chatterTotal;
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
        lastReleaseTimes[i] = eventTime;
      }
      prevButtonStates[i] = pressed;
    });
  } else {
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
