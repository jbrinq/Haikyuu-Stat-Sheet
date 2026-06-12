> **Volleyball Stats Tracker** is a web app for logging and visualizing in-game volleyball performance. Users create an account, add friends, create named matches, and collaboratively track live stats during a game.
>
> Each logged action (kills, digs, aces, blocks, etc.) feeds into a hexagonal radar stat sheet across six axes — Attacking, Serving, Passing, Setting, Blocking, and Defense. Stats are weighted by position, so a Libero's radar reflects their actual role rather than penalizing them for not attacking.
>
> **Stack:** Vanilla JS · Firebase Auth · Firestore · Chart.js
>
> **Features:**
> - Email/password auth with persistent user profiles
> - Friend request system (send, accept, decline, remove)
> - Create and name matches; share them with friends for collaborative logging
> - Per-player stat tracking with position-aware weighting (OH, MB, Opp, Setter, Libero)
> - Live radar chart and stat bars that update on every logged action
> - Action log showing each player's contributions across the match
