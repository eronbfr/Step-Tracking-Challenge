// Team 8 · Step Challenge — app configuration.
// After deploying backend/Code.gs (see docs/SETUP.md) paste the Web App URL below.

export const CONFIG = {
  // Google Apps Script Web App URL (ends with /exec). Empty = demo mode with sample data.
  API_URL: '',

  // Optional: iCloud link of a shared "Team 8 Sync" iPhone Shortcut (see docs/IOS_SHORTCUT.md).
  IOS_SHORTCUT_URL: '',

  APP_URL: 'https://eronbfr.github.io/Step-Tracking-Challenge/',
  VERSION: '1.0.1',

  // Fallback values used before the first server response (the server's values win).
  CHALLENGE: { team: 'Team 8', name: 'Step Challenge', start: '2026-10-20', end: '2026-11-15', dailyGoal: 10000 },

  ROSTER: [
    { id: 'rogelio',  name: 'Rogelio Garcia',         country: 'MX' },
    { id: 'gonza',    name: 'Gonza Souza',            country: 'UY' },
    { id: 'sidnei',   name: 'Sidnei Marcos Guerbali', country: 'BR' },
    { id: 'eron',     name: 'Eron Netto',             country: 'BR' },
    { id: 'danielle', name: 'Danielle Surini',        country: 'BR' },
    { id: 'luis',     name: 'Luís Rodney',            country: 'BR' },
    { id: 'helbert',  name: 'Helbert Contreras',      country: 'CO' },
    { id: 'armando',  name: 'Armando Alarcon',        country: 'MX' },
    { id: 'minerva',  name: 'Minerva Perez',          country: 'MX' },
  ],
};
