// Title screen, pause menu, settings and the controls sheet.
const SETTINGS_KEY = 'solarabay.settings.v1';

export function createMenu(G, hooks) {
  const screens = {
    menu: document.getElementById('menu'),
    pause: document.getElementById('pause'),
    controls: document.getElementById('controls'),
    settings: document.getElementById('settings'),
    loading: document.getElementById('loading'),
  };
  const btnNew = document.getElementById('btnNew');
  const btnContinue = document.getElementById('btnContinue');
  const btnControls = document.getElementById('btnControls');
  const btnSettings = document.getElementById('btnSettings');
  const btnResume = document.getElementById('btnResume');
  const btnSave = document.getElementById('btnSave');
  const btnQuit = document.getElementById('btnQuit');
  const btnPauseControls = document.getElementById('btnPauseControls');
  const btnPauseSettings = document.getElementById('btnPauseSettings');
  const saveInfo = document.getElementById('saveInfo');

  let open = 'menu';
  let settingsReturn = 'menu';
  let controlsReturn = 'menu';

  function show(name) {
    for (const [key, el] of Object.entries(screens)) {
      if (key === 'loading') continue;
      el.classList.toggle('on', key === name);
    }
    open = name;
    if (name) G.input.unlock();
  }

  function hideAll() {
    for (const [key, el] of Object.entries(screens)) {
      if (key === 'loading') continue;
      el.classList.remove('on');
    }
    open = null;
  }

  // ------------------------------------------------------------ settings
  const sens = document.getElementById('setSens');
  const master = document.getElementById('setMaster');
  const music = document.getElementById('setMusic');
  const valSens = document.getElementById('valSens');
  const valMaster = document.getElementById('valMaster');
  const valMusic = document.getElementById('valMusic');

  function applySettings() {
    G.settings.sensitivity = parseFloat(sens.value);
    G.settings.volumeMaster = parseFloat(master.value);
    G.settings.volumeMusic = parseFloat(music.value);
    valSens.textContent = G.settings.sensitivity.toFixed(2);
    valMaster.textContent = `${Math.round(G.settings.volumeMaster * 100)}%`;
    valMusic.textContent = `${Math.round(G.settings.volumeMusic * 100)}%`;
    if (G.audio) {
      G.audio.setVolume('master', G.settings.volumeMaster);
      G.audio.setVolume('music', G.settings.volumeMusic);
    }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.settings));
    } catch {
      /* ignore */
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) Object.assign(G.settings, JSON.parse(raw));
    } catch {
      /* ignore */
    }
    sens.value = G.settings.sensitivity ?? 1;
    master.value = G.settings.volumeMaster ?? 0.8;
    music.value = G.settings.volumeMusic ?? 0.5;
    applySettings();
    for (const b of document.querySelectorAll('[data-quality]')) {
      b.classList.toggle('primary', b.dataset.quality === G.settings.quality);
    }
  }
  loadSettings();

  sens.addEventListener('input', applySettings);
  master.addEventListener('input', applySettings);
  music.addEventListener('input', applySettings);
  for (const b of document.querySelectorAll('[data-quality]')) {
    b.addEventListener('click', () => {
      G.settings.quality = b.dataset.quality;
      for (const other of document.querySelectorAll('[data-quality]')) {
        other.classList.toggle('primary', other === b);
      }
      applySettings();
      if (hooks.onQuality) hooks.onQuality(G.settings.quality);
      G.audio.ui();
    });
  }

  // ------------------------------------------------------------ wiring
  btnNew.addEventListener('click', () => {
    G.audio.resume();
    G.audio.ui();
    hooks.onNewGame();
  });
  btnContinue.addEventListener('click', () => {
    G.audio.resume();
    G.audio.ui();
    hooks.onContinue();
  });
  btnControls.addEventListener('click', () => {
    controlsReturn = 'menu';
    show('controls');
  });
  btnPauseControls.addEventListener('click', () => {
    controlsReturn = 'pause';
    show('controls');
  });
  btnSettings.addEventListener('click', () => {
    settingsReturn = 'menu';
    show('settings');
  });
  btnPauseSettings.addEventListener('click', () => {
    settingsReturn = 'pause';
    show('settings');
  });
  for (const b of document.querySelectorAll('[data-close]')) {
    b.addEventListener('click', () => {
      G.audio.ui();
      show(b.dataset.close === 'settings' ? settingsReturn : controlsReturn);
    });
  }
  btnResume.addEventListener('click', () => {
    G.audio.ui();
    hooks.onResume();
  });
  btnSave.addEventListener('click', () => {
    G.save.save();
    refreshSaveInfo();
  });
  btnQuit.addEventListener('click', () => {
    G.audio.ui();
    hooks.onQuit();
  });

  function refreshSaveInfo() {
    const data = G.save.last || (G.save.hasSave() ? null : null);
    if (G.save.hasSave()) {
      btnContinue.disabled = false;
      const info = data || {};
      const when = info.savedAt ? new Date(info.savedAt).toLocaleString() : 'saved game';
      saveInfo.textContent = `Saved · $${info.money ?? '—'} · ${when}`;
    } else {
      btnContinue.disabled = true;
      saveInfo.textContent = 'No save yet';
    }
  }
  refreshSaveInfo();

  return {
    get open() {
      return open;
    },
    show,
    hideAll,
    refreshSaveInfo,
    showTitle() {
      refreshSaveInfo();
      show('menu');
    },
    showPause() {
      if (G.save && G.save.hasSave()) btnSave.disabled = false;
      refreshSaveInfo();
      show('pause');
    },
    hideLoading() {
      screens.loading.style.display = 'none';
    },
  };
}
