// The heads-up display: cash, wanted stars, health, gun, radar, subtitles,
// objectives and the big cinematic banners.
import { clamp, clamp01, damp } from './util.js';
import { createMinimap } from './minimap.js';

const $ = (id) => document.getElementById(id);

export function createHUD(G) {
  const el = {
    hud: $('hud'),
    money: $('money'),
    stars: $('stars'),
    clock: $('clock'),
    radio: $('radio'),
    objective: $('objective'),
    objectiveText: $('objectiveText'),
    missionTag: $('missionTag'),
    health: $('healthFill'),
    armor: $('armorFill'),
    weaponName: $('weaponName'),
    ammo: $('ammo'),
    minimap: $('minimap'),
    district: $('district'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    notices: $('notices'),
    subtitle: $('subtitle'),
    prompt: $('prompt'),
    busted: $('bustedWrap'),
    bustedFill: $('bustedFill'),
    damage: $('damage'),
    big: $('bigtext'),
    bigTitle: $('bigTitle'),
    bigSub: $('bigSub'),
    speedo: $('speedo'),
    speedVal: $('spdVal'),
  };
  const starEls = Array.from(el.stars.children);
  const drawMap = createMinimap(G.city);
  const notices = [];
  let hitTimer = 0;
  let damageTimer = 0;
  let lastMoney = null;
  let moneyPop = 0;
  let subtitleTimer = 0;
  let bigTimer = 0;
  let lastDistrict = '';

  const api = {
    setVisible(on) {
      el.hud.classList.toggle('on', on);
    },
    setWanted(n) {
      for (let i = 0; i < starEls.length; i++) starEls[i].classList.toggle('on', i < n);
      el.stars.classList.toggle('flash', n >= 3);
    },
    wantedUp() {
      el.stars.animate?.(
        [{ transform: 'scale(1.16)' }, { transform: 'scale(1)' }],
        { duration: 260, easing: 'ease-out' }
      );
    },
    setBustedProgress(p) {
      el.busted.classList.toggle('on', p > 0.02);
      el.bustedFill.style.width = `${clamp01(p) * 100}%`;
    },
    notify(text, dur = 2.2) {
      if (!text) return;
      const div = document.createElement('div');
      div.className = 'notice';
      div.textContent = text;
      el.notices.appendChild(div);
      notices.push({ div, ttl: dur });
      while (notices.length > 4) {
        const old = notices.shift();
        old.div.remove();
      }
    },
    hitMarker() {
      hitTimer = 0.16;
      el.hitmarker.style.opacity = '1';
    },
    flashDamage() {
      damageTimer = 0.9;
      el.damage.style.opacity = '1';
    },
    setObjective(text, tag) {
      el.objective.classList.toggle('on', !!text);
      el.objectiveText.textContent = text || '';
      if (tag) el.missionTag.textContent = tag;
    },
    subtitle(who, text, dur = 3.4) {
      el.subtitle.innerHTML = who ? `<span class="who">${who}:</span> ${text}` : text;
      el.subtitle.classList.add('on');
      subtitleTimer = dur;
    },
    clearSubtitle() {
      el.subtitle.classList.remove('on');
      subtitleTimer = 0;
    },
    prompt(text, key = 'F') {
      if (!text) {
        el.prompt.classList.remove('on');
        return;
      }
      el.prompt.innerHTML = `<b>${key}</b><span>${text}</span>`;
      el.prompt.classList.add('on');
    },
    showBig(title, sub = '', hold = 3) {
      el.bigTitle.textContent = title;
      el.bigSub.textContent = sub;
      el.big.classList.add('on');
      bigTimer = hold;
    },
    hideBig() {
      el.big.classList.remove('on');
      bigTimer = 0;
    },
    update(dt) {
      const p = G.player;

      // cash ticks up visually when it changes
      const money = G.state.money;
      if (lastMoney === null) lastMoney = money;
      if (money !== lastMoney) {
        moneyPop = 1;
        lastMoney = money;
      }
      el.money.textContent = '$' + Math.round(money);
      if (moneyPop > 0) {
        moneyPop = damp(moneyPop, 0, 6, dt);
        el.money.style.transform = `scale(${1 + moneyPop * 0.08})`;
      }

      el.health.style.width = `${clamp(p.health, 0, 100)}%`;
      el.armor.style.width = `${clamp(p.armor, 0, 100)}%`;

      const w = p.currentWeapon();
      el.weaponName.textContent = w.name.toUpperCase();
      if (w.kind === 'melee') {
        el.ammo.textContent = '—';
        el.ammo.classList.remove('low');
      } else {
        el.ammo.textContent = `${w.clipAmmo} / ${w.ammo}`;
        el.ammo.classList.toggle('low', w.clipAmmo <= 2);
      }

      // speedometer, only while driving
      const veh = p.inVehicle;
      el.speedo.classList.toggle('on', !!veh);
      if (veh) el.speedVal.textContent = String(Math.round(Math.abs(veh.speed) * 2.237));

      el.clock.textContent = G.clockText;
      el.radio.textContent = (G.audio?.ready ? G.audio.stationName : G.settings?.radioLabel || 'RADIO OFF').toUpperCase();

      // crosshair spread follows movement and aim
      const aiming = p.aiming && !p.inVehicle;
      el.crosshair.classList.toggle('on', aiming || (p.shooting && !p.inVehicle));
      const spread = 4 + (aiming ? 0 : 4) + clamp(p.speed * 0.5, 0, 6);
      const c = el.crosshair.children;
      c[1].style.transform = `translateY(${-spread - 9}px)`;
      c[2].style.transform = `translateY(${spread}px)`;
      c[3].style.transform = `translateX(${-spread - 9}px)`;
      c[4].style.transform = `translateX(${spread}px)`;

      if (hitTimer > 0) {
        hitTimer -= dt;
        if (hitTimer <= 0) el.hitmarker.style.opacity = '0';
      }
      if (damageTimer > 0) {
        damageTimer -= dt;
        if (damageTimer <= 0) el.damage.style.opacity = '0';
        else el.damage.style.opacity = String(clamp01(damageTimer * 2));
      }
      if (subtitleTimer > 0) {
        subtitleTimer -= dt;
        if (subtitleTimer <= 0) el.subtitle.classList.remove('on');
      }
      if (bigTimer > 0) {
        bigTimer -= dt;
        if (bigTimer <= 0) el.big.classList.remove('on');
      }

      for (let i = notices.length - 1; i >= 0; i--) {
        notices[i].ttl -= dt;
        if (notices[i].ttl <= 0) {
          notices[i].div.style.opacity = '0';
          const div = notices[i].div;
          setTimeout(() => div.remove(), 320);
          notices.splice(i, 1);
        }
      }

      // radar blips
      const blips = [];
      const mission = G.missions?.activeMarker;
      if (mission) blips.push({ x: mission.x, z: mission.z, color: '#ff4f9a', kind: 'mission' });
      for (const m of G.missions?.availableMarkers ?? []) blips.push({ x: m.x, z: m.z, color: '#ffc247', kind: 'mission' });
      for (const ped of G.peds.list) {
        if (ped.kind === 'cop' && ped.alive) blips.push({ x: ped.pos.x, z: ped.pos.z, color: '#4aa8ff', kind: 'police' });
      }
      if (G.police) {
        for (const v of G.vehicles.vehicles) {
          if (v.role === 'police' || v.role === 'fbi') {
            if (Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z) < 120) {
              blips.push({ x: v.pos.x, z: v.pos.z, color: '#4aa8ff', kind: 'police' });
            }
          }
        }
      }
      drawMap(el.minimap, p, blips);

      const district = G.city.districtOf(p.pos.x, p.pos.z).toUpperCase();
      const label = { CENTRICO: 'CENTRICO', BEACH: 'SUNSET STRIP', HABANA: 'LITTLE HABANA', DOCKS: 'PUERTO DOCKS', PARK: 'PARQUE ROJO' }[district] ?? district;
      if (label !== lastDistrict) {
        lastDistrict = label;
        el.district.textContent = label;
      }
    },
  };
  return api;
}
