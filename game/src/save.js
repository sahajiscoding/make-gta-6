// Save games live in localStorage: one slot, autosaved, so a session can be
// picked up later. Nothing leaves the browser.
const KEY = 'solarabay.save.v1';

export function createSave(G) {
  let autosave = 0;
  let lastSaved = null;

  function snapshot() {
    const p = G.player;
    return {
      version: 1,
      savedAt: Date.now(),
      hours: G.time.hours,
      money: G.state.money,
      stats: { ...G.stats },
      player: {
        x: p.pos.x,
        z: p.pos.z,
        heading: p.heading,
        health: p.health,
        armor: p.armor,
        weapon: p.weapon,
        weapons: p.weapons.map((w) => ({ id: w.id, ammo: w.ammo === Infinity ? -1 : w.ammo, clip: w.clipAmmo ?? 0 })),
      },
      police: { heat: G.police.heat },
      missions: G.missions.serialize(),
    };
  }

  function save(quiet = false) {
    try {
      const data = snapshot();
      localStorage.setItem(KEY, JSON.stringify(data));
      lastSaved = data;
      if (!quiet) {
        G.hud.notify('Game saved', 1.6);
        G.audio.ui();
      }
      return true;
    } catch (err) {
      if (!quiet) G.hud.notify('Could not save', 2);
      return false;
    }
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return null;
      return data;
    } catch {
      return null;
    }
  }

  function load() {
    const data = read();
    if (!data) return false;
    const p = G.player;
    G.state.money = data.money ?? 250;
    G.stats = { ...G.stats, ...(data.stats || {}) };
    G.time.hours = data.hours ?? 19;
    if (data.player) {
      p.teleport(data.player.x, data.player.z, data.player.heading ?? 0);
      p.health = data.player.health ?? 100;
      p.armor = data.player.armor ?? 0;
      p.weapon = data.player.weapon ?? 0;
      if (Array.isArray(data.player.weapons)) {
        for (const saved of data.player.weapons) {
          const w = p.weapons.find((x) => x.id === saved.id);
          if (!w) continue;
          w.ammo = saved.ammo === -1 ? Infinity : saved.ammo;
          if (saved.clip !== undefined) w.clipAmmo = saved.clip;
        }
      }
    }
    if (data.police) G.police.setWanted(0);
    G.missions.restore(data.missions);
    lastSaved = data;
    return true;
  }

  function hasSave() {
    return !!read();
  }

  function clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* storage may be unavailable in private mode */
    }
  }

  return {
    save,
    load,
    hasSave,
    clear,
    get last() {
      return lastSaved;
    },
    update(dt) {
      autosave += dt;
      if (autosave > 60) {
        autosave = 0;
        if (G.state.started && G.player.alive) save(true);
      }
    },
  };
}
