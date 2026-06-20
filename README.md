# Gamepad Tester

Application web (Vite + JS vanilla) pour tester et diagnostiquer une manette de jeu directement dans le navigateur, via la Gamepad API.

## Fonctionnalités

- Visualisation en temps réel des sticks (avec détection automatique du point neutre / drift) et des gâchettes
- Test de vibration (moteurs séparés, mode continu)
- Silhouette visuelle fidèle de la manette détectée (Xbox / PlayStation) avec surbrillance des boutons, gâchettes, D-pad et sticks
- Grille de boutons avec latence moyenne et détection de chatter
- Historique des appuis
- Mini-test guidé de comparaison filaire / sans-fil
- Diagnostic des boutons par mashing (détection de chatter, doubles-déclenchements, boutons lents)
- Export PDF du rapport de diagnostic

## Développement

```bash
npm install
npm run dev
```

## Crédits

Les illustrations de manette utilisées pour la silhouette visuelle proviennent du
[Gamepad Asset Pack](https://github.com/AL2009man/Gamepad-Asset-Pack) par AL2009man (licence MIT).
Voir [CREDITS.md](./CREDITS.md) pour le détail.
