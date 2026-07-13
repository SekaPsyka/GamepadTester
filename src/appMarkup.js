export const APP_MARKUP = `
  <header>
    <div class="header-row header-row--brand">
      <div class="header-id">
        <h1>Gamepad Tester</h1>
        <div class="status-pill" role="status" aria-live="polite"><span class="dot" id="dot"></span><span id="padName">Aucune manette détectée</span></div>
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
    <p class="export-status" id="exportReportStatus" role="status" aria-live="polite"></p>
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
        <h2 id="guideTitle">Manette détectée automatiquement</h2>
        <p id="guideDescription">Le navigateur identifie la manette et les commandes qu'elle expose.</p>
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
        <p id="guideNowDescription">Le nom, le nombre de boutons et le nombre d'axes exposés par le navigateur sont affichés ci-dessous.</p>
      </div>
      <ol class="guide-task-list" id="guideTaskList"></ol>
    </section>
    <p class="sr-only" id="guideLiveStatus" role="status" aria-live="polite" aria-atomic="true"></p>
    <div class="guide-actions">
      <button type="button" id="guidePrevBtn" disabled>Étape précédente</button>
      <button type="button" id="guideContextAction" class="guide-context-action hidden"></button>
      <button type="button" id="guideSkipBtn" class="guide-skip hidden">Passer cette étape</button>
      <button type="button" id="guideNextBtn" class="btn-highlight">Continuer vers les sticks</button>
    </div>
  </section>

  <nav class="lab-nav" id="labNav" aria-label="Accès rapide aux outils du laboratoire">
    <span>Accès rapide</span>
    <button type="button" data-lab-target="devicePanel">Manette</button>
    <button type="button" data-lab-target="leftStickPanel">Sticks</button>
    <button type="button" data-lab-target="triggerPanel">Gâchettes</button>
    <button type="button" data-lab-target="buttonsPanel">Boutons</button>
    <button type="button" data-lab-target="resultsPanel">Résultats</button>
  </nav>

  <div class="grid" id="grid">
    <section class="panel device-panel span-2" id="devicePanel" data-guide-section="overview">
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

    <section class="panel stick-panel stick-panel--left" id="leftStickPanel" data-guide-section="sticks">
      <h2>Stick gauche</h2>
      <div class="stick-row">
        <div class="stick-visual">
          <canvas class="stick" id="leftCanvas" width="180" height="180" aria-label="Position et progression des rotations du stick gauche" aria-describedby="leftCalibHint leftCalibResult"></canvas>
          <div class="stick-progress" id="leftCalibProgress" role="progressbar" aria-label="Rotations terminées avec le stick gauche" aria-valuemin="0" aria-valuemax="3" aria-valuenow="0" data-state="idle">
            <div class="stick-progress-heading"><strong>Trois tours réguliers</strong><span class="mono" id="leftCalibProgressText">0 / 3 tours</span></div>
            <div class="stick-progress-track" aria-hidden="true"><span id="leftCalibProgressFill"></span></div>
            <p id="leftCalibHint">Poussez le stick jusqu’au bord, puis faites trois tours réguliers dans le même sens.</p>
          </div>
        </div>
        <div class="sliders" style="flex:1">
          <div class="stick-settings">
            <label for="leftInner">Zone morte intérieure : <span class="mono" id="leftInnerVal"></span></label>
            <input type="range" id="leftInner" min="0" max="0.9" step="0.01" value="0.1" />
            <label for="leftOuter">Zone morte extérieure : <span class="mono" id="leftOuterVal"></span></label>
            <input type="range" id="leftOuter" min="0.1" max="1" step="0.01" value="0.95" />
            <div class="coord">
              Brut: <b class="mono" id="leftRaw">0.00, 0.00</b><br/>
              Ajusté: <b class="mono" id="leftAdj">0.00, 0.00</b>
            </div>
          </div>
          <div class="calib-actions">
            <button id="leftCalibBtn">Commencer les 3 tours du stick</button>
            <button id="leftCalibReset" class="danger">Réinitialiser</button>
          </div>
          <p class="note" id="leftCalibResult"></p>
          <p class="note" id="leftNeutralResult">Point neutre : non testé</p>
        </div>
      </div>
    </section>

    <section class="panel stick-panel stick-panel--right" id="rightStickPanel" data-guide-section="sticks">
      <h2>Stick droit</h2>
      <div class="stick-row">
        <div class="stick-visual">
          <canvas class="stick" id="rightCanvas" width="180" height="180" aria-label="Position et progression des rotations du stick droit" aria-describedby="rightCalibHint rightCalibResult"></canvas>
          <div class="stick-progress" id="rightCalibProgress" role="progressbar" aria-label="Rotations terminées avec le stick droit" aria-valuemin="0" aria-valuemax="3" aria-valuenow="0" data-state="idle">
            <div class="stick-progress-heading"><strong>Trois tours réguliers</strong><span class="mono" id="rightCalibProgressText">0 / 3 tours</span></div>
            <div class="stick-progress-track" aria-hidden="true"><span id="rightCalibProgressFill"></span></div>
            <p id="rightCalibHint">Poussez le stick jusqu’au bord, puis faites trois tours réguliers dans le même sens.</p>
          </div>
        </div>
        <div class="sliders" style="flex:1">
          <div class="stick-settings">
            <label for="rightInner">Zone morte intérieure : <span class="mono" id="rightInnerVal"></span></label>
            <input type="range" id="rightInner" min="0" max="0.9" step="0.01" value="0.1" />
            <label for="rightOuter">Zone morte extérieure : <span class="mono" id="rightOuterVal"></span></label>
            <input type="range" id="rightOuter" min="0.1" max="1" step="0.01" value="0.95" />
            <div class="coord">
              Brut: <b class="mono" id="rightRaw">0.00, 0.00</b><br/>
              Ajusté: <b class="mono" id="rightAdj">0.00, 0.00</b>
            </div>
          </div>
          <div class="calib-actions">
            <button id="rightCalibBtn">Commencer les 3 tours du stick</button>
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

    <section class="panel panel--trigger-vibration span-2" id="triggerPanel" data-guide-section="triggers">
      <h2>Gâchettes &amp; vibration</h2>
      <p class="measurement-instruction">Placez chaque gâchette dans la zone 35–65 %, puis immobilisez votre doigt. Une courte stabilisation précède automatiquement les cinq secondes réellement analysées.</p>
      <div class="trigger-gauges">
        <div class="trigger-gauge">
          <div class="trigger-label"><span>LT</span><span class="mono" id="ltVal">0%</span></div>
          <div class="trigger-bar-bg trigger-bar-bg--thick"><div class="trigger-target-zone" aria-hidden="true"></div><div class="trigger-bar-fill" id="ltBar"></div></div>
          <p class="note trigger-stability-status" id="ltStabilityResult" role="status" aria-live="polite" title="La mesure démarre uniquement après avoir stabilisé la gâchette dans la zone indiquée.">Positionnez la gâchette dans la zone 35–65 %. Le chronomètre attendra que le palier soit stable.</p>
        </div>
        <div class="trigger-gauge">
          <div class="trigger-label"><span>RT</span><span class="mono" id="rtVal">0%</span></div>
          <div class="trigger-bar-bg trigger-bar-bg--thick"><div class="trigger-target-zone" aria-hidden="true"></div><div class="trigger-bar-fill" id="rtBar"></div></div>
          <p class="note trigger-stability-status" id="rtStabilityResult" role="status" aria-live="polite" title="La mesure démarre uniquement après avoir stabilisé la gâchette dans la zone indiquée.">Positionnez la gâchette dans la zone 35–65 %. Le chronomètre attendra que le palier soit stable.</p>
        </div>
      </div>

      <p class="note" style="margin:0 0 6px">Historique des gâchettes (<span class="legend-dot legend-dot--accent"></span> LT, <span class="legend-dot legend-dot--accent-alt"></span> RT)</p>
      <canvas class="graph" id="triggerHistoryGraph" width="1200" height="70" role="img" aria-label="Historique du signal des gâchettes LT et RT"></canvas>
      <p class="note">Un tracé irrégulier mérite une seconde mesure dans les mêmes conditions avant toute conclusion sur le capteur.</p>

      <div class="vib-section">
        <div class="vib-section-head">
          <h3>Vibrations</h3>
          <span class="vib-status" id="vibStatus" role="status" aria-live="polite">Aucune manette</span>
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

    <section class="panel span-2" id="buttonsPanel" data-guide-section="buttons">
      <h2>Boutons <span class="note" style="display:inline">(doubles déclenchements détectés : <span id="chatterCount" class="value mono" style="color:var(--accent-alt)">0</span>)</span></h2>
      <div class="buttons-grid" id="buttonsGrid"></div>
      <p class="note">Un double déclenchement involontaire, aussi appelé chatter, est signalé lorsqu'un bouton numérique se relâche puis se réenfonce en moins de 60 ms. Les gâchettes analogiques sont exclues de ce compteur et analysées séparément ci-dessus.</p>
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
      <p class="note">Les dix derniers appuis numériques sont conservés pour repérer les doubles déclenchements et vérifier le déroulement du test.</p>
    </section>

    <section class="panel span-2 results-panel" id="resultsPanel" data-guide-section="summary">
      <div class="results-heading">
        <div>
          <span class="panel-kicker">Synthèse traçable</span>
          <h2>Résultats du diagnostic</h2>
        </div>
        <span class="confidence-chip" id="summaryConfidence" role="status">Diagnostic incomplet</span>
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
        <p class="note">Préparez-vous avant de commencer : le test passera ensuite automatiquement d'un bouton numérique au suivant. LT/RT et le bouton système Guide/PS sont volontairement exclus.</p>
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
