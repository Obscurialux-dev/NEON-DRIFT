/**
 * DOM overlay screens (title / pause / game over) and the mobile touch pad.
 * The controller knows nothing about the simulation — it only renders the data
 * it is handed and reports clicks back through the callbacks.
 */

const CAUSE_TEXT = {
  hit: 'Clipped by an obstacle. Watch the telegraph glow.',
  saw: 'Walked into a buzzsaw. Brave.',
  fall: 'Fell into a chasm. Always jump earlier than you think.',
  spike: 'Impaled on a spike array.',
  crate: 'Cargo container, 1 — runner, 0.',
  overhang: 'Forgot to slide. The overhead barrier remembers.',
  drone: 'Flattened by a security drone. Duck next time.',
};

export function createScreens(handlers = {}) {
  const el = (id) => document.getElementById(id);

  const title = el('screen-title');
  const pause = el('screen-pause');
  const over = el('screen-over');
  const screens = { title, pause, over };

  const touchJump = el('touch-jump');
  const touchSlide = el('touch-slide');

  /* -------------------------------------------------------------- buttons */
  const bind = (id, fn) => {
    const node = el(id);
    if (!node) return;
    node.addEventListener('click', (event) => {
      event.preventDefault();
      if (handlers.onSound) handlers.onSound('ui');
      fn();
    });
  };

  bind('btn-start', () => handlers.onStart?.());
  bind('btn-resume', () => handlers.onResume?.());
  bind('btn-restart', () => handlers.onRestart?.());
  bind('btn-pause-restart', () => handlers.onRestart?.());
  bind('btn-sound', () => handlers.onToggleSound?.());

  /* ---------------------------------------------------------- touch pads */
  const hold = (node, key) => {
    if (!node) return;
    const press = (event) => {
      event.preventDefault();
      handlers.onTouch?.(key, true);
    };
    const release = (event) => {
      event.preventDefault();
      handlers.onTouch?.(key, false);
    };
    node.addEventListener('pointerdown', press);
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    node.addEventListener('pointerleave', release);
    node.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  hold(touchJump, 'jump');
  hold(touchSlide, 'slide');

  if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) {
    document.body.classList.add('touch');
  }

  /* -------------------------------------------------------------- updates */

  function show(name, data = {}) {
    for (const key of Object.keys(screens)) {
      const node = screens[key];
      if (!node) continue;
      node.classList.toggle('hidden', key !== name);
    }
    if (name === 'pause') {
      setText('pause-score', data.score ?? 0);
      setText('pause-metres', `${Math.floor(data.metres ?? 0)} m`);
    }
    if (name === 'over') {
      renderGameOver(data);
    }
  }

  function renderGameOver(data) {
    const run = data.run ?? {};
    const save = data.save ?? {};
    const records = data.records ?? [];

    setText('over-title', records.includes('score') ? 'NEW HIGH SCORE' : 'SYSTEM FAILURE');
    setText('over-reason', CAUSE_TEXT[data.cause] ?? 'Run terminated.');
    setText('over-score', Math.floor(run.score ?? 0).toLocaleString('en-US'));
    setText('over-metres', `${Math.floor(run.metres ?? 0).toLocaleString('en-US')} m`);
    setText('over-coins', run.coins ?? 0);
    setText('over-chain', run.bestChain ?? 0);
    setText('over-near', run.nearMisses ?? 0);
    setText('over-cleared', run.hazardsCleared ?? 0);
    setText('over-powerups', run.powerupsUsed ?? 0);
    setText('over-cashed', run.cashed ?? 0);
    setText('over-pads', run.padsBought ?? 0);
    setText(
      'over-mult',
      `x${Math.max(1, Math.round(run.multiplier ?? 1))}`,
    );
    setText('over-best', Math.floor(save.bestScore ?? 0).toLocaleString('en-US'));
    setText('over-best-metres', `${Math.floor(save.bestMetres ?? 0)} m`);
    setText('over-total-cashed', Math.floor(save.totalCashed ?? 0).toLocaleString('en-US'));

    const banner = el('over-record');
    if (banner) banner.classList.toggle('hidden', records.length === 0);
  }

  function setTitleStats(save) {
    setText('title-best', Math.floor(save.bestScore ?? 0).toLocaleString('en-US'));
    setText('title-metres', `${Math.floor(save.bestMetres ?? 0)} m`);
    setText('title-runs', save.runs ?? 0);
  }

  function setSound(muted) {
    setText('btn-sound', muted ? 'SOUND: OFF' : 'SOUND: ON');
  }

  function setText(id, value) {
    const node = el(id);
    if (node) node.textContent = String(value);
  }

  return { show, setTitleStats, setSound, screens };
}
