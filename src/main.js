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
} from "./gamepad.js";
import { getTheme, setTheme } from "./storage.js";
import { THEMES, applyTheme } from "./themes.js";
import { MashSequenceTest, gradeForChatter, buildMashVerdict } from "./mashTest.js";
import { createSilhouette, setSilhouetteType, updateSilhouette } from "./controllerSilhouette.js";

const app = document.getElementById("app");

app.innerHTML = `
  <header>
    <div class="header-row">
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
        <button id="openMashTestBtn" class="btn-highlight" title="Teste chaque bouton un par un: appuyez à un rythme rapide et régulier pendant la durée choisie pour détecter chatter, doubles-déclenchements et boutons lents">Diagnostic des boutons</button>
        <button id="exportReportBtn" title="Exporte un rapport de diagnostic en PDF avec l'état actuel de la manette">Exporter rapport (PDF)</button>
        <button id="resetDataBtn" class="danger" title="Réinitialise la latence, le chatter, les calibrations, le drift, l'historique et les captures filaire/sans-fil">Réinitialiser les données</button>
      </div>
    </div>
  </header>

  <div class="empty-state" id="emptyState">
    <div class="empty-state-pulse"></div>
    <h2>En attente d'une manette</h2>
    <p>Branchez une manette filaire ou appairez-la en Bluetooth, puis appuyez sur un bouton pour la réveiller.</p>
  </div>

  <div class="grid" id="grid">
    <section class="panel">
      <h2>Joystick gauche</h2>
      <div class="stick-row">
        <canvas class="stick" id="leftCanvas" width="180" height="180"></canvas>
        <div class="sliders" style="flex:1">
          <label>Dead zone intérieure: <span class="mono" id="leftInnerVal"></span></label>
          <input type="range" id="leftInner" min="0" max="0.9" step="0.01" value="0.1" />
          <label>Dead zone extérieure: <span class="mono" id="leftOuterVal"></span></label>
          <input type="range" id="leftOuter" min="0.1" max="1" step="0.01" value="0.95" />
          <div class="coord">
            Brut: <b class="mono" id="leftRaw">0.00, 0.00</b><br/>
            Ajusté: <b class="mono" id="leftAdj">0.00, 0.00</b>
          </div>
          <div style="display:flex; gap:8px; margin-top:10px">
            <button id="leftCalibBtn">Tester l'amplitude du stick</button>
            <button id="leftCalibReset" class="danger">Réinitialiser</button>
          </div>
          <p class="note" id="leftCalibResult"></p>
          <p class="note" id="leftNeutralResult" title="Point de repos réel du stick, mesuré automatiquement quand il reste stable sans intervention. Un écart par rapport à (0,0) peut indiquer un drift naissant.">Point neutre: mesure en cours...</p>
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>Joystick droit</h2>
      <div class="stick-row">
        <canvas class="stick" id="rightCanvas" width="180" height="180"></canvas>
        <div class="sliders" style="flex:1">
          <label>Dead zone intérieure: <span class="mono" id="rightInnerVal"></span></label>
          <input type="range" id="rightInner" min="0" max="0.9" step="0.01" value="0.1" />
          <label>Dead zone extérieure: <span class="mono" id="rightOuterVal"></span></label>
          <input type="range" id="rightOuter" min="0.1" max="1" step="0.01" value="0.95" />
          <div class="coord">
            Brut: <b class="mono" id="rightRaw">0.00, 0.00</b><br/>
            Ajusté: <b class="mono" id="rightAdj">0.00, 0.00</b>
          </div>
          <div style="display:flex; gap:8px; margin-top:10px">
            <button id="rightCalibBtn">Tester l'amplitude du stick</button>
            <button id="rightCalibReset" class="danger">Réinitialiser</button>
          </div>
          <p class="note" id="rightCalibResult"></p>
          <p class="note" id="rightNeutralResult" title="Point de repos réel du stick, mesuré automatiquement quand il reste stable sans intervention. Un écart par rapport à (0,0) peut indiquer un drift naissant.">Point neutre: mesure en cours...</p>
        </div>
      </div>
    </section>

    <section class="panel span-2">
      <h2>Stabilité des sticks (axe X, détection de drift)</h2>
      <p class="note" style="margin:0 0 6px">Gauche</p>
      <canvas class="graph" id="driftGraphLeft" width="1200" height="70"></canvas>
      <p class="note" style="margin:14px 0 6px">Droit</p>
      <canvas class="graph" id="driftGraphRight" width="1200" height="70"></canvas>
      <p class="note">Au repos, ces lignes doivent rester plates au centre. Des oscillations indiquent du stick drift.</p>
    </section>

    <section class="panel panel--trigger-vibration">
      <h2>Gâchettes &amp; vibration</h2>
      <div class="trigger-gauges">
        <div class="trigger-gauge">
          <div class="trigger-label"><span>LT</span><span class="mono" id="ltVal">0%</span></div>
          <div class="trigger-bar-bg trigger-bar-bg--thick"><div class="trigger-bar-fill" id="ltBar"></div></div>
        </div>
        <div class="trigger-gauge">
          <div class="trigger-label"><span>RT</span><span class="mono" id="rtVal">0%</span></div>
          <div class="trigger-bar-bg trigger-bar-bg--thick"><div class="trigger-bar-fill" id="rtBar"></div></div>
        </div>
      </div>

      <p class="note" style="margin:0 0 6px">Historique des gâchettes (<span class="legend-dot legend-dot--accent"></span> LT, <span class="legend-dot legend-dot--accent-alt"></span> RT)</p>
      <canvas class="graph" id="triggerHistoryGraph" width="1200" height="70"></canvas>
      <p class="note" title="Une gâchette analogique de qualité varie en douceur. Des marches d'escalier ou des sauts brusques dans ce tracé trahissent une faible résolution du capteur ou un potentiomètre qui commence à dérailler.">Un tracé en escalier ou en dents de scie indique une résolution analogique faible ou un capteur de gâchette usé.</p>

      <div class="vib-section">
        <div class="vib-section-head">
          <h3>Vibrations</h3>
          <span class="vib-status" id="vibStatus">Aucune manette</span>
        </div>

        <div class="motor-cards">
          <div class="motor-card" id="motorCardStrong">
            <div class="motor-card-head"><span>Moteur gauche</span><span class="note">basse fréq. / grave</span></div>
            <input type="range" id="vibStrongLive" min="0" max="1" step="0.01" value="0" />
            <div class="motor-card-foot">
              <span class="mono" id="vibStrongLiveVal">0%</span>
              <button id="vibStrongTest">Tester 600 ms</button>
            </div>
          </div>
          <div class="motor-card" id="motorCardWeak">
            <div class="motor-card-head"><span>Moteur droit</span><span class="note">haute fréq. / aiguë</span></div>
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
          <p class="note">Les curseurs produisent une vibration continue (jusqu'à "Tout arrêter"). Les boutons "Tester" et les préréglages envoient une impulsion de 600 ms.</p>
          <p class="note" id="vibNote"></p>
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>Boutons <span class="note" style="display:inline">(latence moyenne: <span id="avgLatency" class="value mono" style="color:var(--accent)">n/a</span>, chatter détecté: <span id="chatterCount" class="value mono" style="color:var(--accent-alt)">0</span>)</span></h2>
      <div id="silhouetteContainer"></div>
      <div class="buttons-grid" id="buttonsGrid"></div>
      <p class="note" title="Chatter: un bouton se déclenche plusieurs fois pour une seule pression physique, souvent dû à l'usure d'un switch/contact.">Le chatter est détecté quand un bouton se relâche puis se ré-enfonce en moins de 60 ms, trop rapide pour une vraie double-pression humaine.</p>
    </section>

    <section class="panel span-2">
      <h2>Historique des appuis</h2>
      <div id="pressLog" class="press-log"></div>
      <p class="note">Dernières 20 entrées, avec latence détectée (delta entre le timestamp matériel de la manette et la réception navigateur, si supporté).</p>
    </section>

    <section class="panel span-2">
      <h2>Comparaison filaire / sans-fil</h2>
      <p class="note" style="margin:0 0 10px">Branchez la manette dans un mode, cliquez sur "Capturer", puis appuyez rapidement sur plusieurs boutons pendant les 5 secondes du compte à rebours (au moins 8 appuis). Changez ensuite de mode (câble/Bluetooth) et recapturez pour comparer.</p>
      <div class="compare-row">
        <div class="compare-col">
          <h3>Filaire</h3>
          <button id="captureWired">Capturer la session actuelle</button>
          <p class="note" id="wiredSnapshot">Aucune capture.</p>
        </div>
        <div class="compare-col">
          <h3>Sans-fil</h3>
          <button id="captureWireless">Capturer la session actuelle</button>
          <p class="note" id="wirelessSnapshot">Aucune capture.</p>
        </div>
      </div>
      <p class="note" id="compareDelta"></p>
    </section>
  </div>

  <div class="mash-overlay" id="mashOverlay">
    <div class="mash-panel">
      <div id="mashSetup">
        <h2>Diagnostic des boutons (mashing)</h2>
        <p class="note">Le test passe en revue chaque bouton détecté du mapping actuel. Pour chacun, appuyez de façon répétée pendant la durée choisie, le chrono démarre à votre premier appui. Permet de repérer le chatter, les doubles-déclenchements fantômes et les boutons lents à revenir en position.</p>
        <div class="mash-optimal-conditions">
          <h3>Pour un résultat fiable</h3>
          <ul>
            <li>Appuyez à un rythme <strong>rapide mais net et régulier</strong>, en relâchant bien chaque bouton entre deux appuis, plutôt que de mashing brut au maximum de vitesse.</li>
            <li>Batterie/piles pleines, ou manette branchée en filaire.</li>
            <li>Privilégiez une connexion filaire ; en sans-fil, restez proche du récepteur.</li>
            <li>Fermez les autres applications ou onglets qui pourraient utiliser la manette en même temps.</li>
            <li>Visez <strong>au moins 20 appuis</strong> par bouton sur la durée du test: en dessous, le résultat est jugé pas assez fiable pour conclure (affiché "N/A").</li>
          </ul>
        </div>
        <p class="note" id="mashSetupWarning"></p>
        <label class="field">Durée par bouton
          <select id="mashDuration">
            <option value="5000">5 secondes</option>
            <option value="10000">10 secondes</option>
          </select>
        </label>
        <div class="mash-actions">
          <button id="mashStartBtn">Démarrer le test</button>
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

function setConnectedUI(connected) {
  dot.classList.toggle("connected", connected);
  emptyState.classList.toggle("visible", !connected);
  grid.classList.toggle("disconnected", !connected);
  if (!connected) padName.textContent = "Aucune manette détectée";
}
setConnectedUI(false);

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

// Pulsation visuelle déclenchée par l'intention d'envoi, pas par un retour matériel:
// l'API ne renvoie aucun état de vibration en cours, donc on stoppe l'animation
// nous-mêmes (catch / fin de durée) pour ne jamais donner un faux retour positif.
function pulseMotorCard(card, duration) {
  card.classList.add("active");
  setTimeout(() => card.classList.remove("active"), duration);
}

function playRumble(weak, strong, duration = 600, { cards = [] } = {}) {
  const pad = getSelectedGamepad();
  const actuator = pad?.vibrationActuator;
  if (!actuator) {
    vibNote.textContent = "Vibration non supportée par cette manette/navigateur.";
    return Promise.resolve();
  }
  for (const card of cards) pulseMotorCard(card, duration);
  return actuator
    .playEffect("dual-rumble", {
      startDelay: 0,
      duration,
      weakMagnitude: weak,
      strongMagnitude: strong,
    })
    .then(() => {
      vibNote.textContent = "";
    })
    .catch(() => {
      vibNote.textContent = "Effet de vibration refusé.";
      resetVibrationUI();
    });
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
  playRumble(0, 0, 1);
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
  const refresh = () => playRumble(weak, strong, 300);
  refresh();
  liveRumbleTimer = setInterval(refresh, 250);
}

vibStrongLive.addEventListener("input", syncLiveRumble);
vibWeakLive.addEventListener("input", syncLiveRumble);

document.getElementById("vibStrongTest").addEventListener("click", () =>
  playRumble(0, 1, 600, { cards: [motorCardStrong] })
);
document.getElementById("vibWeakTest").addEventListener("click", () =>
  playRumble(1, 0, 600, { cards: [motorCardWeak] })
);
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
  left: { active: false, points: [] },
  right: { active: false, points: [] },
};

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

  btn.addEventListener("click", () => {
    if (!state.active) {
      state.active = true;
      state.points = [];
      btn.textContent = "Arrêter & afficher le résultat";
      resultEl.textContent = "Calibration en cours, faites le tour complet du stick...";
    } else {
      state.active = false;
      btn.textContent = "Tester l'amplitude du stick";
      if (state.points.length < 5) {
        resultEl.textContent = "Pas assez de données, réessayez.";
        return;
      }
      const verdict = analyzeRange(state.points);
      resultEl.textContent = verdict;
    }
  });

  resetBtn.addEventListener("click", () => {
    state.active = false;
    state.points = [];
    btn.textContent = "Tester l'amplitude du stick";
    resultEl.textContent = "";
  });
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

function neutralDriftStatus(offset) {
  if (!offset.measured) return { key: "na", label: "Point neutre: mesure en cours (relâchez le stick)..." };
  if (offset.magnitude > NEUTRAL_DRIFT_WARN_THRESHOLD) {
    return {
      key: "fair",
      label: `Point neutre décalé: ${offset.x.toFixed(3)}, ${offset.y.toFixed(3)} (drift naissant possible)`,
    };
  }
  return { key: "excellent", label: `Point neutre: ${offset.x.toFixed(3)}, ${offset.y.toFixed(3)} (centré ✓)` };
}

function renderNeutralDrift(side) {
  const offset = neutralDrift[side].getOffset();
  const status = neutralDriftStatus(offset);
  const el = neutralResultEls[side];
  el.textContent = status.label;
  el.className = `note mash-grade-${status.key}`;
  return offset;
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

let mashTest = null;
let lastMashResults = null;

function showMashScreen(screen) {
  mashSetupEl.classList.toggle("hidden", screen !== "setup");
  mashRunningEl.classList.toggle("hidden", screen !== "running");
  mashSummaryEl.classList.toggle("hidden", screen !== "summary");
}

function closeMashOverlay() {
  mashOverlay.classList.remove("visible");
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

function openMashSetup() {
  const hasPad = Boolean(getSelectedGamepad());
  mashSetupWarningEl.textContent = hasPad ? "" : "Aucune manette connectée, branchez-la avant de démarrer.";
  mashStartBtnEl.disabled = !hasPad;
  showMashScreen("setup");
}

document.getElementById("openMashTestBtn").addEventListener("click", () => {
  if (lastMashResults) {
    renderMashSummaryTable(lastMashResults);
    showMashScreen("summary");
  } else {
    openMashSetup();
  }
  mashOverlay.classList.add("visible");
});

document.getElementById("mashCancelSetupBtn").addEventListener("click", closeMashOverlay);

document.getElementById("mashRetestBtn").addEventListener("click", () => {
  lastMashResults = null;
  openMashSetup();
});

mashStartBtnEl.addEventListener("click", () => {
  const pad = getSelectedGamepad();
  if (!pad) return;
  const durationMs = Number(mashDurationSelect.value);
  const buttonCount = Math.min(currentLabels.length, pad.buttons.length);
  const queue = Array.from({ length: buttonCount }, (_, i) => ({ index: i, label: currentLabels[i] || `Bouton ${i}` }));
  mashTest = new MashSequenceTest(queue, durationMs);
  showMashScreen("running");
});

document.getElementById("mashAbortBtn").addEventListener("click", () => {
  mashTest = null;
  closeMashOverlay();
});

document.getElementById("mashCloseBtn").addEventListener("click", closeMashOverlay);

const pressLog = document.getElementById("pressLog");
const avgLatencyEl = document.getElementById("avgLatency");
const latencySamples = [];
let currentAvgLatencyMs = null;

function logPress(label, latencyMs) {
  const entry = document.createElement("div");
  const time = new Date().toLocaleTimeString();
  entry.className = "press-log-entry";
  entry.textContent = latencyMs != null ? `[${time}] ${label} (latence ~${latencyMs.toFixed(1)} ms)` : `[${time}] ${label}`;
  pressLog.prepend(entry);
  while (pressLog.children.length > 20) pressLog.removeChild(pressLog.lastChild);

  if (latencyMs != null && latencyMs >= 0 && latencyMs < 500) {
    latencySamples.push(latencyMs);
    if (latencySamples.length > 30) latencySamples.shift();
    currentAvgLatencyMs = latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length;
    avgLatencyEl.textContent = `${currentAvgLatencyMs.toFixed(1)} ms`;

    if (compareCapture && latencyMs >= 0 && latencyMs < 500) {
      compareCapture.samples.push(latencyMs);
    }
  }
}

const COMPARE_CAPTURE_DURATION_MS = 5000;
const COMPARE_MIN_SAMPLES = 8;

const compareSnapshots = { wired: null, wireless: null };
const compareElByMode = {
  wired: document.getElementById("wiredSnapshot"),
  wireless: document.getElementById("wirelessSnapshot"),
};
const compareButtonByMode = {
  wired: document.getElementById("captureWired"),
  wireless: document.getElementById("captureWireless"),
};
const compareDeltaEl = document.getElementById("compareDelta");
let compareCapture = null; // { mode, padId, samples: [], endAt }

function renderCompareSnapshot(mode) {
  const snap = compareSnapshots[mode];
  const el = compareElByMode[mode];
  if (!snap) {
    el.textContent = "Aucune capture.";
    return;
  }
  el.textContent = `${snap.padId} (latence moy.: ${snap.avgLatencyMs.toFixed(1)} ms, ${snap.sampleCount} échantillons, capturé à ${snap.capturedAt})`;
}

function renderCompareDelta() {
  const { wired, wireless } = compareSnapshots;
  if (!wired || !wireless) {
    compareDeltaEl.textContent = "";
    return;
  }
  const delta = wireless.avgLatencyMs - wired.avgLatencyMs;
  const sign = delta >= 0 ? "+" : "";
  compareDeltaEl.textContent = `Écart sans-fil vs filaire: ${sign}${delta.toFixed(1)} ms${delta > 0 ? " (sans-fil plus lent)" : delta < 0 ? " (sans-fil plus rapide, vérifiez vos captures)" : " (aucune différence)"}`;
}

function setCompareButtonsDisabled(disabled) {
  compareButtonByMode.wired.disabled = disabled;
  compareButtonByMode.wireless.disabled = disabled;
}

function tickCompareCapture() {
  if (!compareCapture) return;
  const remainingMs = compareCapture.endAt - performance.now();
  if (remainingMs <= 0) {
    finishCompareCapture();
    return;
  }
  const el = compareElByMode[compareCapture.mode];
  const seconds = Math.ceil(remainingMs / 1000);
  const count = compareCapture.samples.length;
  el.textContent = `Appuyez sur des boutons... ${seconds}s restantes (${count} échantillon${count === 1 ? "" : "s"})`;
  requestAnimationFrame(tickCompareCapture);
}

function finishCompareCapture() {
  const { mode, padId, samples } = compareCapture;
  compareCapture = null;
  setCompareButtonsDisabled(false);
  compareButtonByMode[mode].textContent = "Capturer la session actuelle";

  if (samples.length < COMPARE_MIN_SAMPLES) {
    compareElByMode[mode].textContent = `Pas assez d'échantillons (${samples.length}/${COMPARE_MIN_SAMPLES}), appuyez plus souvent sur des boutons puis recommencez.`;
    return;
  }
  compareSnapshots[mode] = {
    padId,
    avgLatencyMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    sampleCount: samples.length,
    capturedAt: new Date().toLocaleTimeString(),
  };
  renderCompareSnapshot(mode);
  renderCompareDelta();
}

function captureCompareSnapshot(mode) {
  if (compareCapture) return;
  const pad = getSelectedGamepad();
  if (!pad) {
    compareElByMode[mode].textContent = "Aucune manette connectée.";
    return;
  }
  compareCapture = { mode, padId: pad.id, samples: [], endAt: performance.now() + COMPARE_CAPTURE_DURATION_MS };
  setCompareButtonsDisabled(true);
  compareButtonByMode[mode].textContent = "Capture en cours...";
  tickCompareCapture();
}

document.getElementById("captureWired").addEventListener("click", () => captureCompareSnapshot("wired"));
document.getElementById("captureWireless").addEventListener("click", () => captureCompareSnapshot("wireless"));

let prevButtonStates = [];
let lastReleaseTimes = [];
let lastPadCount = 0;
let lastPadId = null;

let chatterTotal = 0;
const chatterByButton = new Map();
const chatterCountEl = document.getElementById("chatterCount");

function buildDiagnosticReport() {
  const pad = getSelectedGamepad();
  return {
    generatedAt: new Date().toISOString(),
    gamepad: pad
      ? { id: pad.id, index: pad.index, mappingType: detectControllerType(pad.id), buttonCount: pad.buttons.length, axisCount: pad.axes.length }
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
    latency: {
      averageMs: currentAvgLatencyMs != null ? Number(currentAvgLatencyMs.toFixed(1)) : null,
      sampleCount: latencySamples.length,
    },
    chatterEventsTotal: chatterTotal,
    chatterByButton: [...chatterByButton.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    wiredVsWirelessComparison: compareSnapshots,
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

function isAsymmetryWarning(calibrationText) {
  return typeof calibrationText === "string" && calibrationText.startsWith("Asymétrie détectée");
}

function computeDiagnosticVerdict(report) {
  const items = [];

  if (!report.gamepad) {
    items.push({ status: "bad", title: "Manette", text: "Aucune manette connectée au moment de l'export." });
  } else {
    items.push({ status: "ok", title: "Manette", text: `${report.gamepad.id} détectée, ${report.gamepad.buttonCount} boutons, ${report.gamepad.axisCount} axes.` });
  }

  const leftWarn = isAsymmetryWarning(report.calibration.left);
  const rightWarn = isAsymmetryWarning(report.calibration.right);
  if (!report.calibration.left && !report.calibration.right) {
    items.push({ status: "neutral", title: "Sticks", text: "Aucune calibration de range effectuée, usure/drift localisé non vérifié." });
  } else if (leftWarn || rightWarn) {
    const sides = [leftWarn ? "gauche" : null, rightWarn ? "droit" : null].filter(Boolean).join(" et ");
    items.push({ status: "warn", title: "Sticks", text: `Asymétrie détectée sur le stick ${sides}, possible usure ou drift localisé, voir détail ci-dessous.` });
  } else {
    items.push({ status: "ok", title: "Sticks", text: "Aucune asymétrie détectée sur les sticks calibrés." });
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
      items.push({
        status: "warn",
        title: "Point neutre des sticks",
        text: `Décalage du point de repos détecté sur le stick ${driftedSides.join(" et ")}, signe possible d'un drift naissant même si la calibration de range ne montre pas encore d'asymétrie.`,
      });
    }
  }

  if (report.latency.sampleCount < 5) {
    items.push({ status: "neutral", title: "Latence", text: "Pas assez d'échantillons, appuyez sur quelques boutons pour mesurer." });
  } else if (report.latency.averageMs <= 20) {
    items.push({ status: "ok", title: "Latence", text: `${report.latency.averageMs} ms en moyenne, excellente réactivité.` });
  } else if (report.latency.averageMs <= 40) {
    items.push({ status: "warn", title: "Latence", text: `${report.latency.averageMs} ms en moyenne, correcte, peut indiquer du Bluetooth ou un polling réduit.` });
  } else {
    items.push({ status: "bad", title: "Latence", text: `${report.latency.averageMs} ms en moyenne, élevée, vérifiez la connexion (sans-fil, dongle, câble).` });
  }

  if (report.chatterEventsTotal === 0) {
    items.push({ status: "ok", title: "Chatter", text: "Aucun événement de chatter détecté." });
  } else {
    const worst = report.chatterByButton[0];
    const detail = worst ? ` Bouton le plus touché: ${worst.label} (${worst.count} fois).` : "";
    items.push({
      status: report.chatterEventsTotal >= 5 ? "bad" : "warn",
      title: "Chatter",
      text: `${report.chatterEventsTotal} événement(s) détecté(s) sur ${report.chatterByButton.length} bouton(s).${detail}`,
    });
  }

  if (!report.mashTest) {
    items.push({
      status: "neutral",
      title: "Diagnostic des boutons",
      text: "Aucun test de mashing effectué, chatter et boutons lents non vérifiés bouton par bouton.",
    });
  } else {
    const totalPressCount = report.mashTest.reduce((sum, r) => sum + r.pressCount, 0);
    const totalChatter = report.mashTest.reduce((sum, r) => sum + r.chatterCount, 0);
    const grade = gradeForChatter(totalChatter, totalPressCount);
    const statusByGrade = { excellent: "ok", good: "ok", fair: "warn", poor: "bad", na: "neutral" };

    let text;
    if (grade.key === "na") {
      text = "Pas assez d'appuis enregistrés pendant le diagnostic pour conclure sur la fiabilité des boutons.";
    } else if (totalChatter === 0) {
      text = `Test effectué sur ${report.mashTest.length} bouton(s), aucun chatter détecté pendant le mashing, fiabilité ${grade.label.toLowerCase()}.`;
    } else {
      const worst = [...report.mashTest].sort((a, b) => b.chatterCount - a.chatterCount)[0];
      text = `Fiabilité ${grade.label.toLowerCase()} (${totalChatter} chatter sur ${totalPressCount} appuis pendant le mashing). Bouton le plus touché: ${worst.label} (${worst.chatterCount} fois).`;
    }
    items.push({ status: statusByGrade[grade.key], title: "Diagnostic des boutons", text });
  }

  return items;
}

const PDF_MARGIN = 15;
const PDF_PAGE_WIDTH = 210;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const PDF_CYAN = [0, 130, 150];
const PDF_MAGENTA = [70, 75, 90];
const PDF_DARK = [30, 32, 40];
const PDF_MUTED = [110, 110, 110];
const PDF_GRADE_STATUS = { excellent: "ok", good: "ok", fair: "warn", poor: "bad", na: "neutral" };
const PDF_STATUS_COLORS = {
  ok: [30, 150, 90],
  warn: [200, 140, 0],
  bad: [200, 50, 50],
  neutral: [140, 140, 140],
};
const PDF_STATUS_LABELS = { ok: "OK", warn: "ATTENTION", bad: "PROBLÈME", neutral: "N/A" };

function pdfEnsureSpace(doc, y, needed) {
  if (y + needed > 280) {
    doc.addPage();
    return 18;
  }
  return y;
}

function pdfSectionHeader(doc, title, y, color) {
  y = pdfEnsureSpace(doc, y, 16);
  doc.setFillColor(...color);
  doc.rect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.text(title, PDF_MARGIN + 3, y + 5.5);
  doc.setFont(undefined, "normal");
  return y + 8 + 5;
}

function pdfVerdictRow(doc, item, y) {
  const color = PDF_STATUS_COLORS[item.status];
  const lines = doc.splitTextToSize(item.text, PDF_CONTENT_WIDTH - 28);
  y = pdfEnsureSpace(doc, y, lines.length * 4.5 + 6);

  doc.setFillColor(...color);
  doc.circle(PDF_MARGIN + 2, y + 1, 1.3, "F");

  doc.setFontSize(9.5);
  doc.setFont(undefined, "bold");
  doc.setTextColor(...color);
  doc.text(`${item.title} : ${PDF_STATUS_LABELS[item.status]}`, PDF_MARGIN + 6, y + 2);
  y += 5;

  doc.setFont(undefined, "normal");
  doc.setTextColor(...PDF_DARK);
  doc.text(lines, PDF_MARGIN + 6, y);
  y += lines.length * 4.5 + 3;
  return y;
}

function buildDiagnosticPdf(report) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 18;

  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.setTextColor(...PDF_DARK);
  doc.text("Gamepad Diagnostic Report", PDF_MARGIN, y);
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_MUTED);
  y += 6;
  doc.text(`Généré le ${new Date(report.generatedAt).toLocaleString()}`, PDF_MARGIN, y);
  y += 10;

  y = pdfSectionHeader(doc, "Résumé du diagnostic", y, PDF_MAGENTA);
  for (const item of computeDiagnosticVerdict(report)) {
    y = pdfVerdictRow(doc, item, y);
  }
  y += 5;

  y = pdfSectionHeader(doc, "Manette", y, PDF_CYAN);
  doc.setFontSize(10);
  doc.setTextColor(...PDF_DARK);
  if (report.gamepad) {
    doc.text(`Nom: ${report.gamepad.id}`, PDF_MARGIN + 2, y);
    y += 5;
    doc.text(
      `Mapping détecté: ${report.gamepad.mappingType}, ${report.gamepad.buttonCount} boutons, ${report.gamepad.axisCount} axes`,
      PDF_MARGIN + 2,
      y
    );
    y += 10;
  } else {
    doc.text("Aucune manette connectée au moment de l'export.", PDF_MARGIN + 2, y);
    y += 10;
  }

  y = pdfSectionHeader(doc, "Dead Zones", y, PDF_CYAN);
  autoTable(doc, {
    startY: y,
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    head: [["Stick", "Inner", "Outer"]],
    body: [
      ["Gauche", report.deadzones.left.inner.toFixed(2), report.deadzones.left.outer.toFixed(2)],
      ["Droit", report.deadzones.right.inner.toFixed(2), report.deadzones.right.outer.toFixed(2)],
    ],
    theme: "grid",
    headStyles: { fillColor: PDF_CYAN, textColor: 255 },
    styles: { fontSize: 10, textColor: PDF_DARK },
  });
  y = doc.lastAutoTable.finalY + 10;

  y = pdfSectionHeader(doc, "Calibration de range", y, PDF_MAGENTA);
  doc.setFontSize(10);
  doc.setTextColor(...PDF_DARK);
  for (const [label, text] of [
    ["Gauche", report.calibration.left || "Aucune calibration effectuée."],
    ["Droit", report.calibration.right || "Aucune calibration effectuée."],
  ]) {
    doc.setFont(undefined, "bold");
    doc.text(`${label}:`, PDF_MARGIN + 2, y);
    doc.setFont(undefined, "normal");
    const lines = doc.splitTextToSize(text, PDF_CONTENT_WIDTH - 4);
    y = pdfEnsureSpace(doc, y, lines.length * 5 + 8);
    doc.text(lines, PDF_MARGIN + 2, y + 5);
    y += lines.length * 5 + 8;
  }

  y = pdfSectionHeader(doc, "Point neutre des sticks", y, PDF_MAGENTA);
  doc.setFontSize(10);
  doc.setTextColor(...PDF_DARK);
  for (const [label, offset] of [
    ["Gauche", report.neutralDrift.left],
    ["Droit", report.neutralDrift.right],
  ]) {
    const text = offset.measured
      ? `${label}: ${offset.x.toFixed(3)}, ${offset.y.toFixed(3)}${offset.magnitude > NEUTRAL_DRIFT_WARN_THRESHOLD ? " (décalé, drift naissant possible)" : " (centré)"}`
      : `${label}: pas encore mesuré.`;
    doc.text(text, PDF_MARGIN + 2, y);
    y += 5;
  }
  y += 5;

  y = pdfSectionHeader(doc, "Latence & Chatter", y, PDF_MAGENTA);
  doc.setFontSize(10);
  doc.setTextColor(...PDF_DARK);
  const avgText =
    report.latency.averageMs != null ? `${report.latency.averageMs} ms (${report.latency.sampleCount} échantillons)` : "n/a";
  doc.text(`Latence moyenne: ${avgText}`, PDF_MARGIN + 2, y);
  y += 5;
  doc.text(`Événements de chatter détectés: ${report.chatterEventsTotal}`, PDF_MARGIN + 2, y);
  y += 8;

  if (report.chatterByButton.length > 0) {
    y = pdfEnsureSpace(doc, y, 16);
    autoTable(doc, {
      startY: y,
      margin: { left: PDF_MARGIN, right: PDF_MARGIN },
      head: [["Bouton", "Événements de chatter"]],
      body: report.chatterByButton.map((b) => [b.label, String(b.count)]),
      theme: "grid",
      headStyles: { fillColor: PDF_MAGENTA, textColor: 255 },
      styles: { fontSize: 9, textColor: PDF_DARK },
    });
    y = doc.lastAutoTable.finalY + 10;
  } else {
    y += 2;
  }

  y = pdfSectionHeader(doc, "Diagnostic des boutons (mashing)", y, PDF_MAGENTA);
  if (report.mashTest && report.mashTest.length) {
    const totalPressCount = report.mashTest.reduce((sum, r) => sum + r.pressCount, 0);
    const totalChatter = report.mashTest.reduce((sum, r) => sum + r.chatterCount, 0);
    const overallGrade = gradeForChatter(totalChatter, totalPressCount);
    doc.setFontSize(10);
    doc.setTextColor(...PDF_DARK);
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
      head: [["Bouton", "Appuis", "Appuis/s", "Chatter", "Fiabilité"]],
      body: report.mashTest.map((r, i) => [
        r.label,
        String(r.pressCount),
        r.pressesPerSecond.toFixed(1),
        String(r.chatterCount),
        r.reliable === false ? `${mashGrades[i].label} (*)` : mashGrades[i].label,
      ]),
      theme: "grid",
      headStyles: { fillColor: PDF_MAGENTA, textColor: 255 },
      styles: { fontSize: 9, textColor: PDF_DARK },
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
    y += verdictLines.length * 4.5 + 10;
  } else {
    doc.setFontSize(10);
    doc.setTextColor(...PDF_DARK);
    doc.text("Aucun test de réactivité effectué.", PDF_MARGIN + 2, y);
    y += 10;
  }

  y = pdfSectionHeader(doc, "Comparaison filaire / sans-fil", y, PDF_CYAN);
  const { wired, wireless } = report.wiredVsWirelessComparison;
  if (wired || wireless) {
    autoTable(doc, {
      startY: y,
      margin: { left: PDF_MARGIN, right: PDF_MARGIN },
      head: [["Mode", "Manette", "Latence moy.", "Échantillons", "Capturé à"]],
      body: [
        wired
          ? ["Filaire", wired.padId, `${wired.avgLatencyMs.toFixed(1)} ms`, String(wired.sampleCount), wired.capturedAt]
          : ["Filaire", "n/a", "n/a", "n/a", "n/a"],
        wireless
          ? [
              "Sans-fil",
              wireless.padId,
              `${wireless.avgLatencyMs.toFixed(1)} ms`,
              String(wireless.sampleCount),
              wireless.capturedAt,
            ]
          : ["Sans-fil", "n/a", "n/a", "n/a", "n/a"],
      ],
      theme: "grid",
      headStyles: { fillColor: PDF_CYAN, textColor: 255 },
      styles: { fontSize: 9, textColor: PDF_DARK },
    });
    y = doc.lastAutoTable.finalY + 6;
    if (wired && wireless) {
      const delta = wireless.avgLatencyMs - wired.avgLatencyMs;
      const sign = delta >= 0 ? "+" : "";
      doc.setFontSize(10);
      doc.setTextColor(...PDF_DARK);
      doc.text(`Écart sans-fil vs filaire: ${sign}${delta.toFixed(1)} ms`, PDF_MARGIN + 2, y);
    }
  } else {
    doc.setFontSize(10);
    doc.setTextColor(...PDF_DARK);
    doc.text("Aucune capture effectuée.", PDF_MARGIN + 2, y);
    y += 10;
  }

  y = pdfSectionHeader(doc, "Limites de ce diagnostic", y, PDF_DARK);
  doc.setFontSize(9);
  doc.setTextColor(...PDF_DARK);
  const limitsLines = doc.splitTextToSize(
    "Ce rapport dépend du navigateur et du système utilisés (fréquence de lecture de la manette, throttling d'un onglet en arrière-plan, pilote...). " +
      "Il donne une bonne indication de l'état de la manette mais ne remplace pas un diagnostic matériel certifié. " +
      "Un résultat isolé sur un seul bouton n'implique pas forcément un défaut, retestez avant de conclure, surtout si le reste du diagnostic est bon.",
    PDF_CONTENT_WIDTH - 4,
  );
  doc.text(limitsLines, PDF_MARGIN + 2, y);

  return doc;
}

document.getElementById("exportReportBtn").addEventListener("click", () => {
  const report = buildDiagnosticReport();
  const doc = buildDiagnosticPdf(report);
  doc.save(`gamepad-report-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`);
});

document.getElementById("resetDataBtn").addEventListener("click", () => {
  if (!window.confirm("Réinitialiser toutes les données collectées (latence, chatter, calibration, drift, comparaison) ? Cette action est irréversible.")) {
    return;
  }

  latencySamples.length = 0;
  currentAvgLatencyMs = null;
  avgLatencyEl.textContent = "n/a";

  chatterTotal = 0;
  chatterByButton.clear();
  chatterCountEl.textContent = "0";
  prevButtonStates = [];
  lastReleaseTimes = [];

  driftHistoryLeft.fill(0);
  driftHistoryRight.fill(0);

  pressLog.innerHTML = "";

  compareCapture = null;
  setCompareButtonsDisabled(false);
  compareButtonByMode.wired.textContent = "Capturer la session actuelle";
  compareButtonByMode.wireless.textContent = "Capturer la session actuelle";
  compareSnapshots.wired = null;
  compareSnapshots.wireless = null;
  renderCompareSnapshot("wired");
  renderCompareSnapshot("wireless");
  renderCompareDelta();

  mashTest = null;
  lastMashResults = null;

  document.getElementById("leftCalibReset").click();
  document.getElementById("rightCalibReset").click();

  neutralDrift.left.reset();
  neutralDrift.right.reset();
  renderNeutralDrift("left");
  renderNeutralDrift("right");
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
      prevButtonStates = [];
      lastReleaseTimes = [];
      neutralDrift.left.reset();
      neutralDrift.right.reset();
      const controllerType = detectControllerType(pad.id);
      if (controllerType !== currentSilhouetteType) {
        currentSilhouetteType = controllerType;
        setSilhouetteType(silhouette, controllerType);
      }
      updateVibStatus();
    }

    const now = frameNow;
    // pad.timestamp est l'horodatage natif du driver pour le dernier état lu, plus précis
    // que le temps de la frame rAF pour dater les transitions presse/relâche, car il ne
    // dépend pas du moment où le navigateur a exécuté la frame.
    const gamepadTimestamp = Number.isFinite(pad.timestamp) && pad.timestamp > 0 ? pad.timestamp : null;
    const eventTime = gamepadTimestamp ?? now;

    if (mashTest && !mashTest.finished) {
      mashTest.feed(pad.buttons, now, frameGapMs, gamepadTimestamp);
      if (mashTest.finished) {
        lastMashResults = mashTest.results;
        renderMashSummaryTable(lastMashResults);
        showMashScreen("summary");
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

    neutralDrift.left.update(lx, ly, now);
    neutralDrift.right.update(rx, ry, now);
    renderNeutralDrift("left");
    renderNeutralDrift("right");

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

    updateSilhouette(silhouette, pad);

    pad.buttons.forEach((btn, i) => {
      const cell = buttonCells[i];
      const pressed = btn.pressed || btn.value > 0.08;
      if (cell) {
        if (pressed) cell.classList.add("active");
        else cell.classList.remove("active");
      }
      const wasPressed = prevButtonStates[i] || false;
      if (pressed && !wasPressed) {
        const latency = Number.isFinite(pad.timestamp) && pad.timestamp > 0 ? now - pad.timestamp : null;
        const label = currentLabels[i] || `Bouton ${i}`;
        const sinceRelease = lastReleaseTimes[i];
        if (sinceRelease != null && eventTime - sinceRelease < CHATTER_THRESHOLD_MS) {
          chatterTotal++;
          chatterByButton.set(label, (chatterByButton.get(label) || 0) + 1);
          chatterCountEl.textContent = chatterTotal;
          logPress(`⚠ Chatter : ${label} re-déclenché ${(eventTime - sinceRelease).toFixed(1)} ms après relâche`, null);
          if (cell) {
            cell.classList.add("chatter");
            setTimeout(() => cell.classList.remove("chatter"), 400);
          }
        } else {
          logPress(label, latency);
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
