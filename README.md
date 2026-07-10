# Gamepad Tester

Application web (Vite + JS vanilla) pour tester et diagnostiquer une manette de jeu directement dans le navigateur, via la Gamepad API.

## Fonctionnalités

- Diagnostic guidé en cinq étapes, avec mode laboratoire pour les valeurs brutes
- Mesure volontaire du point neutre et analyse de l'amplitude des sticks
- Test de vibration (moteurs séparés, mode continu)
- Silhouette visuelle fidèle de la manette détectée (Xbox / PlayStation) avec surbrillance des boutons, gâchettes, D-pad et sticks
- Grille de boutons avec détection des doubles déclenchements involontaires (chatter)
- Historique des appuis
- Diagnostic guidé des boutons avec contrôle de la fiabilité de la mesure
- Export PDF du rapport de diagnostic

Les résultats distinguent les mesures cohérentes, les points à confirmer et les tests non réalisés. L'application ne prétend pas mesurer la latence matérielle, que la Gamepad API du navigateur n'expose pas de manière fiable.

## Développement

```bash
npm install
npm run dev
```

## Crédits

Les illustrations de manette utilisées pour la silhouette visuelle proviennent du
[Gamepad Asset Pack](https://github.com/AL2009man/Gamepad-Asset-Pack) par AL2009man (licence MIT).
Voir [CREDITS.md](./CREDITS.md) pour le détail et
[THIRD_PARTY_NOTICES.txt](./public/THIRD_PARTY_NOTICES.txt) pour le texte complet de la licence.
