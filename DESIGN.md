---
name: GamepadTester
description: Banc d'essai lisible pour diagnostiquer une manette avec précision sans intimider.
colors:
  measurement-black: "#090b10"
  panel-slate: "#121722"
  raised-slate: "#171d2a"
  technical-line: "#283143"
  signal-primary: "#00f0ff"
  signal-secondary: "#ff00e6"
  signal-tint: "#161a2c"
  validation-green: "#45d483"
  attention-amber: "#f3c969"
  anomaly-red: "#ff6475"
  measurement-green: "#39ff8c"
  measurement-yellow: "#ffe600"
  explanation-gray: "#a4adbd"
  reading-white: "#f2f5f8"
  control-black: "#0d0f18"
  graph-black: "#060710"
typography:
  display:
    fontFamily: "Bahnschrift Condensed, Arial Narrow, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "2px"
  headline:
    fontFamily: "Bahnschrift Condensed, Arial Narrow, Segoe UI, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.015em"
  title:
    fontFamily: "Bahnschrift Condensed, Arial Narrow, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.02em"
  body:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Consolas, SFMono-Regular, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.04em"
  data:
    fontFamily: "Consolas, SFMono-Regular, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  compact: "5px"
  control: "8px"
  panel: "10px"
  visual: "12px"
  dialog: "16px"
  pill: "999px"
spacing:
  micro: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
components:
  button-default:
    backgroundColor: "{colors.control-black}"
    textColor: "{colors.reading-white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "40px"
  button-primary:
    backgroundColor: "#0f3541"
    textColor: "{colors.signal-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "40px"
  field:
    backgroundColor: "{colors.control-black}"
    textColor: "{colors.reading-white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    height: "40px"
  panel:
    backgroundColor: "{colors.panel-slate}"
    textColor: "{colors.reading-white}"
    rounded: "{rounded.panel}"
    padding: "{spacing.xl}"
  status-chip:
    backgroundColor: "{colors.raised-slate}"
    textColor: "{colors.explanation-gray}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 9px"
  task-current:
    backgroundColor: "#1d2222"
    textColor: "{colors.reading-white}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "44px"
  mode-switch:
    backgroundColor: "{colors.measurement-black}"
    textColor: "{colors.explanation-gray}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "3px"
  progress-track:
    backgroundColor: "{colors.technical-line}"
    rounded: "{rounded.pill}"
    height: "6px"
---

# Design System: GamepadTester

## Overview

**Creative North Star: "Le banc d'essai lisible"**

GamepadTester ressemble à un instrument de mesure fiable que l'on comprend sans manuel. L'interface est sombre, précise et pédagogique : elle concentre l'attention sur la tâche en cours, rend chaque état observable et réserve les signaux lumineux aux actions ou aux résultats qui comptent.

La densité est maîtrisée, jamais spectaculaire. Le système rejette explicitement les interfaces gaming excessivement chargées, les effets visuels gratuits, le jargon non expliqué et les verdicts alarmistes. Les surfaces techniques restent familières, les consignes précèdent les mesures et le mode laboratoire peut être plus dense sans contaminer la simplicité du parcours guidé.

**Key Characteristics:**

- Sombre et contrasté, conçu comme un outil de diagnostic.
- Compact, tactile et sans ambiguïté.
- Néon fonctionnel réservé aux états, aux mesures et aux actions.
- Responsive par restructuration des panneaux, jamais par réduction illisible.
- Mouvement bref et informatif, désactivable avec la préférence de réduction des animations.

**The Instrument Rule.** Chaque élément visuel doit aider à préparer, exécuter ou interpréter une mesure. Tout ornement sans fonction est interdit.

## Colors

La palette associe des ardoises presque noires à deux signaux électriques et à trois états sémantiques prudents.

### Primary

- **Signal principal** (`#00f0ff`) : action prioritaire, sélection courante, focus et mesure active. Le thème choisi peut remplacer cette valeur, mais jamais sa fonction.

### Secondary

- **Signal secondaire** (`#ff00e6`) : contraste ponctuel pour une seconde série, une action destructive au survol ou une mesure opposée. Il ne concurrence jamais l'action principale.

### Tertiary

- **Validation** (`#45d483`) : réussite confirmée et état terminé.
- **Attention** (`#f3c969`) : résultat à interpréter avec prudence ou mesure à reprendre.
- **Anomalie** (`#ff6475`) : erreur, échec ou résultat clairement défavorable.
- **Vert de mesure** (`#39ff8c`) et **jaune de mesure** (`#ffe600`) : valeurs instrumentales et repères de progression spécifiques, jamais décoration.

### Neutral

- **Noir de mesure** (`#090b10`) : fond principal qui absorbe le bruit visuel.
- **Ardoise de panneau** (`#121722`) : surface standard des groupes fonctionnels.
- **Ardoise surélevée** (`#171d2a`) : surface active, imbriquée ou temporairement mise en avant.
- **Trait technique** (`#283143`) : bordure, séparateur et contour inactif.
- **Noir de contrôle** (`#0d0f18`) : boutons et champs au repos.
- **Noir de graphe** (`#060710`) : canevas et zones de données.
- **Blanc de lecture** (`#f2f5f8`) : texte principal.
- **Gris d'explication** (`#a4adbd`) : aide secondaire et métadonnées, sans devenir du texte décoratif à faible contraste.

**The Signal Rarity Rule.** Les accents saturés servent uniquement aux actions, aux sélections et aux états mesurés. Une grande surface inactive ne doit jamais être saturée.

## Typography

**Display Font:** Bahnschrift Condensed (avec Arial Narrow, puis Segoe UI)
**Body Font:** Segoe UI (avec system-ui)
**Label/Mono Font:** Consolas (avec SFMono-Regular)

**Character:** La typographie de titre donne un caractère d'instrument technique sans transformer les contrôles en affiche. Segoe UI porte les consignes, tandis que Consolas stabilise les valeurs et les libellés courts.

### Hierarchy

- **Display** (400, 24px, 1.2, espacement 2px) : identité principale en capitales, utilisée une seule fois dans l'en-tête.
- **Headline** (600, 32px, 1.2) : titre de l'étape guidée et point d'entrée de la tâche.
- **Title** (600, 22px, 1.25) : intitulé d'une action ou d'un sous-ensemble de diagnostic.
- **Body** (400, 13px, 1.5) : consignes et explications, limitées à environ 72 caractères par ligne lorsqu'elles forment un paragraphe.
- **Label** (600, 11px, espacement 0.04em) : état, repère court et métadonnée technique.
- **Data** (400, 12px, 1.5, chiffres tabulaires) : valeurs brutes, chronomètres et résultats comparables.

**The Three Voices Rule.** Bahnschrift nomme, Segoe UI explique et Consolas mesure. Aucun autre rôle typographique ne doit être inventé.

## Elevation

Le système utilise d'abord la superposition tonale et les bordures fines. Les ombres sont faibles et ambiantes : elles distinguent une surface active ou temporaire, tandis que les halos signalent exclusivement un focus, un survol ou une activité mesurée.

### Shadow Vocabulary

- **Relief actif** (`0 4px 8px rgba(0, 0, 0, 0.18)`) : bloc de consigne en cours ou surface momentanément avancée.
- **Liseré supérieur** (`inset 0 1px 0 rgba(255, 255, 255, 0.03)`) : séparation subtile d'un panneau sur le fond.
- **Halo d'interaction** (`0 0 10px color-mix(in srgb, var(--accent) 30%, transparent)`) : survol ou focus d'un contrôle.
- **Présence de dialogue** (`0 0 40px color-mix(in srgb, var(--accent) 12%, transparent)`) : dialogue natif au-dessus de son arrière-plan.

**The Tonal-First Rule.** Une surface au repos est séparée par sa teinte et une bordure de 1px. Si une ombre devient le premier élément visible, elle est trop forte.

## Components

Les composants sont compacts, tactiles et sans ambiguïté. Ils partagent le même vocabulaire de bordures, de rayons et d'états dans le parcours guidé comme dans le laboratoire.

### Buttons

- **Shape:** angles doucement techniques (8px), hauteur minimale de 40px sur ordinateur et 44px sur mobile.
- **Primary:** fond teinté par le signal principal, texte et bordure dans ce même signal, graisse 600 et espacement interne 8px × 14px.
- **Hover / Focus:** halo court, changement simultané de bordure et de texte ; focus visible par contour de 2px décalé de 3px.
- **Active / Disabled:** compression à 96 % uniquement pendant l'appui ; opacité 42 % et aucune ombre lorsque l'action est indisponible.
- **Secondary / Danger:** contrôle sombre au repos ; le danger emploie le signal secondaire uniquement au survol.

### Chips

- **Style:** forme pilule (999px), libellé mono compact et fond ardoise. Le texte nomme toujours l'état en plus de la couleur.
- **State:** validation, attention et anomalie utilisent leurs couleurs sémantiques respectives sans modifier la géométrie.

### Cards / Containers

- **Corner Style:** panneaux à 10px, visualisations spécialisées à 12px et dialogues à 16px.
- **Background:** ardoise de panneau au repos, ardoise surélevée ou teinte légère du signal pour la tâche active.
- **Shadow Strategy:** profondeur tonale par défaut, relief actif uniquement pour le bloc qui réclame l'attention immédiate.
- **Border:** trait technique continu de 1px autour de la surface complète.
- **Internal Padding:** 20px par défaut, 16px sur les surfaces resserrées.

### Inputs / Fields

- **Style:** fond noir de contrôle, trait technique de 1px, rayon de 8px, hauteur minimale de 40px et texte de 12px.
- **Focus:** bordure signal principal et double anneau lumineux ; aucun changement de disposition.
- **Error / Disabled:** employer une couleur sémantique et un texte explicite ; ne jamais dépendre de la couleur seule.

### Navigation

- **Style:** le sélecteur de mode forme un contrôle segmenté sombre. L'onglet actif reçoit une teinte légère du signal, une bordure claire et un texte plus affirmé.
- **Responsive:** les panneaux se réorganisent aux seuils 960px, 720px, 560px et 360px ; les cibles tactiles atteignent 44px et aucun contenu ne déborde horizontalement.

### Guided Task

- **Style:** chaque tâche est une rangée complète à rayon de 8px et hauteur minimale de 44px. Un marqueur, un libellé et un état textuel décrivent ensemble sa progression.
- **State:** l'étape courante utilise le signal principal, l'étape terminée la validation, et l'étape restante conserve un contraste neutre.

### Progress and Measurement

- **Style:** piste de 6px en forme de pilule, remplissage dans le signal associé et valeurs en chiffres tabulaires.
- **Motion:** transitions d'état entre 80 et 150ms. Les pulsations sont rares, liées à une acquisition active et supprimées avec `prefers-reduced-motion`.

**The Complete-State Rule.** Tout composant interactif doit définir repos, survol, focus, appui et indisponibilité ; un état actif doit toujours avoir un libellé compréhensible.

## Do's and Don'ts

### Do:

- Do guider l'utilisateur avant chaque mesure et maintenir la tâche active comme point focal dominant.
- Do utiliser le signal principal pour l'action ou la mesure courante, et les couleurs sémantiques pour les résultats nommés.
- Do conserver les bordures complètes de 1px, les rayons de 8 à 10px et les espacements récurrents de 8, 12, 16, 20 et 24px.
- Do garder les chiffres comparables en Consolas avec des chiffres tabulaires.
- Do communiquer chaque état par une combinaison de couleur, de texte et de structure compatible clavier et WCAG 2.2 AA.
- Do restructurer les panneaux aux seuils existants et préserver des cibles tactiles d'au moins 44px sur mobile.

### Don't:

- Don't créer une interface gaming excessivement chargée ni saturer les surfaces inactives.
- Don't ajouter d'effets visuels gratuits, de mouvement décoratif, de texte en dégradé ou de glassmorphism.
- Don't employer du jargon non expliqué dans les consignes, les états ou les résultats.
- Don't afficher de verdicts alarmistes qui présentent une mesure imparfaite comme une certitude matérielle.
- Don't utiliser une bande colorée latérale de plus de 1px comme décoration de carte ou d'alerte.
- Don't inventer une nouvelle forme de bouton, de champ ou de panneau pour une seule fonctionnalité.
- Don't réduire les textes ou les cibles pour faire tenir une grille mobile ; réorganiser la structure à la place.
