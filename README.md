# Révisions

Mini PWA sobre pour réviser :

- **les tables de multiplication** (1 à 12) — on tape le résultat sur un pavé numérique intégré ;
- **l'alphabet** (quelle lettre vient après ?) — clavier AZERTY intégré, dont l'ordre ne révèle pas la réponse ;
- **le code secret César +1** (`lune → mvof`) — coder et décoder des mots français
  (liste embarquée, classée par longueur puis difficulté, nombre de mots actifs réglable).

Chaque réponse est chronométrée. Un système de répétition espacée type Anki (SM-2 simplifié)
planifie les révisions quotidiennes : la note d'une carte dépend de la justesse **et** du temps
de réaction (faux / juste mais lent / juste / juste et rapide). Les statistiques détaillées
montrent l'activité, la précision, les temps moyens et une carte de maîtrise par
multiplication / par lettre.

Installable sur Android/iOS (« Ajouter à l'écran d'accueil ») et utilisable hors-ligne.

## Sécurité / supply chain

Ce projet est volontairement **sans aucune dépendance** :

- pas de `package.json`, pas de npm, pas de build — HTML/CSS/JS vanilla servis tels quels ;
- pas de GitHub Actions — déploiement GitHub Pages directement depuis la branche `main` ;
- aucune ressource externe (fonts, CDN, analytics) : tout est servi depuis le dépôt ;
- les données restent dans le `localStorage` de l'appareil, rien n'est envoyé en ligne ;
- les icônes PNG sont générées par `tools/gen_icons.py` (stdlib Python uniquement).

## Développement

```sh
python3 -m http.server 8917   # puis http://127.0.0.1:8917/
```
