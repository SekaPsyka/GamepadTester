# GamepadTester

App web (Vite + JS vanilla, pas de framework) qui teste/diagnostique une manette via la Gamepad API du navigateur, dans `index.html` (single-page, tout le rendu DOM est généré par `src/main.js`).

## Conventions

- **UI et commentaires en français.** Le code (noms de variables/fonctions) reste en anglais.
- Vanilla JS, modules ES (`type: "module"`), pas de framework, pas de bundler de tests.
- Commentaires uniquement pour expliquer un *pourquoi* non évident (seuils choisis, contournement, invariant) — jamais pour décrire ce que fait le code. Voir `gamepad.js` (`NEUTRAL_DRIFT_WARN_THRESHOLD`, `CHATTER_THRESHOLD_MS`) pour le ton attendu.
- Détection du type de manette centralisée dans `detectControllerType()` (`src/gamepad.js`) — toujours réutiliser cette fonction plutôt que dupliquer une regex sur `pad.id`.
- Mapping standard Gamepad API : boutons 0-3 = A/B/X/Y (Croix/Cercle/Carré/Triangle), 4-5 = LB/RB (L1/R1), 6-7 = LT/RT (L2/R2), 8-9 = View/Menu (Share/Options), 10-11 = clic stick gauche/droit, 12-15 = D-pad haut/bas/gauche/droite, 16 = Guide/PS. `pad.axes[0..1]` = stick gauche X/Y, `[2..3]` = stick droit X/Y.

## Structure

- `src/main.js` — point d'entrée, construit le DOM, boucle `requestAnimationFrame`, orchestre tous les modules.
- `src/gamepad.js` — accès Gamepad API, détection de type de manette, labels de boutons, dead zone, détection de drift du point neutre (`NeutralDriftTracker`).
- `src/controllerSilhouette.js` — silhouette visuelle (image SVG Xbox/PlayStation + zones de surbrillance positionnées en % du viewBox d'origine). Layouts de boutons/sticks codés en dur dans `LAYOUTS`. Se dégrade proprement (frame caché) pour les manettes "generic".
- `src/mashTest.js` — diagnostic des boutons par mashing (chatter, double-déclenchement, boutons lents).
- `src/themes.js` / `src/storage.js` — thèmes de couleur (CSS custom properties) et persistance `localStorage`.
- `src/style.css` — feuille de style unique, pas de CSS modules.
- `src/assets/controllers/*.svg` — assets visuels de manette, voir `CREDITS.md` (licence MIT, Gamepad Asset Pack).

## Tester sans manette physique

Pour valider une fonctionnalité visuellement sans manette branchée : lancer `npm run dev`, ouvrir la page dans le navigateur (claude-in-chrome), puis injecter un faux `navigator.getGamepads` via `javascript_tool` pour simuler boutons/axes. Vérifier ensuite par capture d'écran/zoom plutôt que de supposer que le rendu est correct.

## Git

- Ne jamais `git add -A` : stager les fichiers explicitement par nom.
- Ne jamais pusher sans demande explicite de l'utilisateur à chaque fois (une autorisation ne vaut pas pour les fois suivantes).

## Maintenance de ce fichier

Mettre à jour ce fichier quand l'architecture change de façon notable (nouveau module, changement de convention, nouvelle dépendance structurante) — pas besoin de demander, le faire au fil de l'eau comme pour le reste du code.
