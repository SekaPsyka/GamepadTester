# GamepadTester

App web (Vite + JS vanilla, pas de framework) qui teste/diagnostique une manette via la Gamepad API du navigateur, dans `index.html` (single-page, le gabarit DOM de `src/appMarkup.js` est monté par `src/main.js`).

## Conventions

- **UI et commentaires en français.** Le code (noms de variables/fonctions) reste en anglais.
- Vanilla JS, modules ES (`type: "module"`), pas de framework. Les tests de logique utilisent le runner natif `node --test --test-isolation=none` via `npm test` (l'isolation évite les sous-processus bloqués par le bac à sable Windows).
- Commentaires uniquement pour expliquer un *pourquoi* non évident (seuils choisis, contournement, invariant) — jamais pour décrire ce que fait le code. Voir `gamepad.js` (`NEUTRAL_DRIFT_WARN_THRESHOLD`, `CHATTER_THRESHOLD_MS`) pour le ton attendu.
- Détection du type de manette centralisée dans `detectControllerType()` (`src/gamepad.js`) — toujours réutiliser cette fonction plutôt que dupliquer une regex sur `pad.id`.
- État pressé/relâché (digital ou gâchette analogique) centralisé dans `isButtonPressed()` (`src/gamepad.js`) — gère l'hystérésis sur LT/RT (index 6/7), toujours réutiliser plutôt que comparer `btn.value`/`btn.pressed` à la main.
- Trackers à fenêtre glissante (`NeutralDriftTracker`/`TriggerStabilityTracker` dans `src/gamepad.js`) : ne purger le plus vieil échantillon que si le suivant couvre déjà seul la fenêtre. Le point neutre est déclenché explicitement par l'utilisateur pendant trois secondes ; la stabilité des gâchettes reste mesurée pendant leur maintien.
- Mapping standard Gamepad API : boutons 0-3 = A/B/X/Y (Croix/Cercle/Carré/Triangle), 4-5 = LB/RB (L1/R1), 6-7 = LT/RT (L2/R2), 8-9 = View/Menu (Share/Options), 10-11 = clic stick gauche/droit, 12-15 = D-pad haut/bas/gauche/droite, 16 = Guide/PS. `pad.axes[0..1]` = stick gauche X/Y, `[2..3]` = stick droit X/Y.
- Le bouton Guide/PS reste observable dans l'interface en direct, mais il est volontairement exclu du diagnostic répété des boutons.
- Une commande haptique réussie confirme seulement que le navigateur l'a acceptée : l'application ne peut pas mesurer ni certifier la force physique réellement produite par un moteur.
- Les états du parcours guidé sont calculés dans une fonction pure. Toute évolution d'un diagnostic doit conserver la cohérence entre le guide, la synthèse à l'écran, la réinitialisation et le rapport PDF.
- Interface entièrement responsive (`src/style.css`, breakpoints à 960px/720px/560px/360px) — toute nouvelle UI doit rester utilisable sur mobile (cibles tactiles ≥44px, pas d'overflow horizontal).

## Structure

- `src/main.js` — point d'entrée, monte le DOM, orchestre le diagnostic guidé / mode laboratoire et la boucle `requestAnimationFrame`. `jspdf` et `jspdf-autotable` doivent rester chargés dynamiquement au moment de l'export pour préserver le bundle initial.
- `src/appMarkup.js` — gabarit HTML statique de la page, séparé de l'orchestration.
- `src/diagnosticSession.js` — propriétaire unique des mesures de la manette active. Un changement ou une reconnexion de manette remplace atomiquement la session pour empêcher tout mélange de résultats.
- `src/stickDiagnostics.js` — analyse pure et structurée de l'amplitude des sticks ; le texte affiché ne doit jamais servir de donnée métier.
- `src/diagnosticReport.js` — instantané pur de la session et calcul des verdicts partagés par l'écran et le PDF.
- `src/diagnosticPdf.js` — mise en page du rapport PDF, sans acquisition ni mutation de la session.
- `src/gamepad.js` — accès Gamepad API, détection de type de manette, labels de boutons, dead zone, état pressé digital/analogique (`isButtonPressed`), détection de drift du point neutre (`NeutralDriftTracker`) et de stabilité des gâchettes tenues à un palier (`TriggerStabilityTracker`).
- `src/guideFlow.js` — logique pure des étapes, tâches et états du parcours guidé, ainsi que normalisation des résultats des commandes haptiques.
- `src/controllerSilhouette.js` — silhouette visuelle (image SVG Xbox/PlayStation + zones de surbrillance positionnées en % du viewBox d'origine). Layouts de boutons/sticks codés en dur dans `LAYOUTS`. Se dégrade proprement (frame caché) pour les manettes "generic".
- `src/mashTest.js` — diagnostic répété des boutons (chatter / doubles déclenchements involontaires et fiabilité de la session).
- `src/diagnosticSummary.js` — logique pure des états de synthèse, du statut de connexion et des formulations françaises de fiabilité partagées par l'interface et le PDF.
- `src/themes.js` / `src/storage.js` — thèmes de couleur (CSS custom properties) et persistance `localStorage`.
- `src/style.css` — feuille de style unique, pas de CSS modules.
- `src/assets/controllers/*.svg` — assets visuels de manette, voir `CREDITS.md` (licence MIT, Gamepad Asset Pack).
- `test/*.test.js` — tests déterministes des zones mortes, de l'hystérésis, du point neutre, des gâchettes, du diagnostic répété des boutons, des sessions par manette, de l'analyse structurée des sticks et des verdicts du rapport.

## Tester sans manette physique

Pour valider une fonctionnalité visuellement sans manette branchée : lancer `npm run dev`, ouvrir la page dans un navigateur contrôlable, puis injecter un faux `navigator.getGamepads` pour simuler boutons/axes. Vérifier ensuite par capture d'écran/zoom plutôt que de supposer que le rendu est correct.
- Injecter via un `<script>` ajouté au DOM (`document.documentElement.appendChild`), pas via un outil d'évaluation susceptible de s'exécuter dans un contexte isolé qui ne modifie pas le `navigator` vu par l'app.
- L'onglet doit rester visible/au premier plan : Chrome gèle `requestAnimationFrame` (donc toute la boucle de l'app) sur un onglet en arrière-plan, ce qui peut faire croire à un bug alors que c'est juste l'onglet qui a perdu le focus.
- Pour des trackers basés sur le temps (fenêtres glissantes, hystérésis), valider la logique isolément avec un petit script Node qui importe `gamepad.js` directement et simule des appels `update()` à pas de temps fixe, plutôt que de se fier uniquement au rendu navigateur (plus rapide, et insensible aux problèmes de focus d'onglet ci-dessus).

## Validation

- Exécuter `npm test` puis `npm run build` après toute modification applicative.
- Pour un changement d'interface, vérifier aussi les modes guidé et laboratoire, les thèmes concernés, le clavier et au moins un format desktop et mobile.
- Les tests automatisés ne remplacent pas un contrôle avec une vraie manette pour les comportements matériels ou temporels.

## Git

- Ne jamais `git add -A` : stager les fichiers explicitement par nom.
- Ne jamais créer de commit sans demande explicite de l'utilisateur.
- Ne jamais pusher sans demande explicite de l'utilisateur à chaque fois (une autorisation ne vaut pas pour les fois suivantes).

## Maintenance de ce fichier

Mettre à jour ce fichier quand l'architecture change de façon notable (nouveau module, changement de convention, nouvelle dépendance structurante) — pas besoin de demander, le faire au fil de l'eau comme pour le reste du code.
