'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'app_settings.json');
}

const DEFAULTS = {
  // Détection des jeux installés sans launcher tiers (via le registre de
  // désinstallation Windows) : désactivée par défaut, car intrinsèquement
  // plus susceptible de faux positifs (n'importe quel logiciel peut y
  // ressembler) que les scanners dédiés à un launcher précis.
  standaloneGameScanEnabled: false,
};

function getSettings() {
  try {
    const p = getSettingsPath();
    if (!fs.existsSync(p)) return { ...DEFAULTS };
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...DEFAULTS, ...data };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function setSetting(key, value) {
  const current = getSettings();
  current[key] = value;
  const p = getSettingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(current, null, 2), 'utf8');
  return current;
}

module.exports = { getSettings, setSetting };
