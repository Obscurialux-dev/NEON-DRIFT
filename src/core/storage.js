/**
 * Persistence for best-run records. localStorage is optional: in private mode
 * or over file:// it can throw, so every access is guarded.
 */
import { CONFIG } from '../config.js';

const DEFAULTS = {
  bestScore: 0,
  bestMetres: 0,
  bestCoins: 0,
  bestChain: 0,
  runs: 0,
  totalMetres: 0,
  muted: false,
  /** Lifetime chain spent on charge pads (the run-to-run progression line). */
  totalCashed: 0,
  totalPads: 0,
};

export function loadSave() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/**
 * Fold a finished run into the save record.
 * @returns `{{ save, records: string[] }}` — which records were beaten.
 */
export function recordRun(save, run) {
  const records = [];
  if (run.score > save.bestScore) {
    save.bestScore = Math.floor(run.score);
    records.push('score');
  }
  if (run.metres > save.bestMetres) {
    save.bestMetres = Math.floor(run.metres);
    records.push('distance');
  }
  if (run.coins > save.bestCoins) {
    save.bestCoins = run.coins;
    records.push('coins');
  }
  if (run.bestChain > save.bestChain) {
    save.bestChain = run.bestChain;
    records.push('chain');
  }
  save.runs += 1;
  save.totalMetres += Math.floor(run.metres);
  save.totalCashed += Math.max(0, Math.floor(run.cashed ?? 0));
  save.totalPads += Math.max(0, Math.floor(run.padsBought ?? 0));
  writeSave(save);
  return { save, records };
}
