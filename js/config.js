// Nokia - Step Challenge 2026 - Team 8 — app configuration (shared by the app and the GitHub Action in backend/).
//
// Backend = this GitHub repository:
//   • the app publishes signed messages to a public relay topic (ntfy.sh) and every open app sees them live;
//   • the "Ledger" GitHub Action folds them into data/data.json + step-tracking_Team8.xlsx every few minutes.
// See docs/SETUP.md for the full picture.

export const CONFIG = {
  // Relay (ntfy-compatible pub/sub). The topic name is public: anything sent here is signed and validated.
  RELAY_URL: 'https://ntfy.sh',
  RELAY_TOPIC: 't8steps-2026-o58d4zb7pyzw',

  // Persisted snapshot written by the Action. raw.githubusercontent.com sees a commit within minutes,
  // GitHub Pages (same origin) a bit later — the app reads both and keeps the newest.
  REPO: 'eronbfr/Step-Tracking-Challenge',
  DATA_URL: 'https://raw.githubusercontent.com/eronbfr/Step-Tracking-Challenge/main/data/data.json',
  SHEET_URL: 'https://github.com/eronbfr/Step-Tracking-Challenge/raw/main/step-tracking_Team8.xlsx',
  // Stories media kept by the Action (the relay only holds uploads for 3 hours). Branch rewritten with the live stories only.
  STORIES_URL: 'https://raw.githubusercontent.com/eronbfr/Step-Tracking-Challenge/stories',

  // Members whose devices can approve sign-ins and reset anyone's devices (team captain).
  ADMINS: ['eron'],

  // Optional: iCloud link of a shared "Team 8 Sync" iPhone Shortcut (see docs/IOS_SHORTCUT.md).
  IOS_SHORTCUT_URL: '',

  // Brand for titles and texts. The home-screen label is the manifest's short_name ("Nokia Team 8").
  BRAND: 'Nokia - Step Challenge 2026 - Team 8',
  APP_URL: 'https://eronbfr.github.io/Step-Tracking-Challenge/',
  VERSION: '2.3.0',

  CHALLENGE: { team: 'Team 8', name: 'Step Challenge', start: '2026-10-20', end: '2026-11-15', dailyGoal: 10000 },

  // city: home pin on the Team map (ids in js/worldmap.js PLACES: cdmx, bog, rio, sp, mvd); defaults to the country's capital.
  ROSTER: [
    { id: 'rogelio',  name: 'Rogelio Garcia',         country: 'MX', city: 'cdmx' },
    { id: 'gonza',    name: 'Gonza Souza',            country: 'UY', city: 'mvd' },
    { id: 'sidnei',   name: 'Sidnei Marcos Guerbali', country: 'BR', city: 'sp' },
    { id: 'eron',     name: 'Eron Netto',             country: 'BR', city: 'rio' },
    { id: 'danielle', name: 'Danielle Surini',        country: 'BR', city: 'sp' },
    { id: 'luis',     name: 'Luís Rodney',            country: 'BR', city: 'sp' },
    { id: 'helbert',  name: 'Helbert Contreras',      country: 'CO', city: 'bog' },
    { id: 'armando',  name: 'Armando Alarcon',        country: 'MX', city: 'cdmx' },
    { id: 'minerva',  name: 'Minerva Perez',          country: 'MX', city: 'cdmx' },
  ],
};
