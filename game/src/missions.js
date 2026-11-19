// The story of Solara Bay: eight jobs for Rico Salas, from a motel room to the
// top of the Delgado tower. Each mission is a list of small objective steps, so
// the engine stays readable and the writing stays the interesting part.
import * as THREE from 'three';
import { clamp01 } from './util.js';

const TAU = Math.PI * 2;

export function createMissions(G) {
  const city = G.city;
  const spots = city.spots;

  // ---------------------------------------------------------------- helpers
  function nearestRoadX(x) {
    return city.roads.xs.reduce((a, v) => (Math.abs(v - x) < Math.abs(a - x) ? v : a), city.roads.xs[0]);
  }
  function nearestRoadZ(z) {
    return city.roads.zs.reduce((a, v) => (Math.abs(v - z) < Math.abs(a - z) ? v : a), city.roads.zs[0]);
  }
  function carAt(model, x, z, heading = 0) {
    // snap a spawned story car onto the nearest lane
    const rx = nearestRoadX(x);
    const rz = nearestRoadZ(z);
    const onXs = Math.abs(x - rx) < 40;
    const px = onXs ? rx + 4.6 : x;
    const pz = onXs ? z : rz + 4.6;
    return G.vehicles.spawnVehicle(model, { x: px, z: pz, heading: onXs ? Math.PI / 2 : 0 });
  }

  // ---------------------------------------------------------------- scripts
  const defs = [
    {
      id: 'homecoming',
      name: 'HOME COMING',
      startAt: spots.motel,
      reward: 150,
      intro: [
        ['Bruno', 'Rico Salas. Eight years in a cell and you still walk like the cops owe you money.', 3.6],
        ['Rico', 'They do. I did the time for a boss who forgot my name.', 3.2],
        ['Bruno', 'Then remind them. Get to the motel and I will find you some work.', 3.4],
      ],
      steps: [{ type: 'goto', x: spots.motel.x + 3, z: spots.motel.z + 14, r: 3.2, text: 'Walk to the Sol y Sombra motel' }],
      outro: [
        ['Bruno', 'That tower on the hill? Delgado built it with money he borrowed from my mother.', 3.6],
        ['Bruno', 'Sleep. Tomorrow we find you a car.', 3],
      ],
    },
    {
      id: 'wheels',
      name: 'WHEELS FIRST',
      startAt: { x: spots.motel.x + 3, z: spots.motel.z + 14 },
      reward: 220,
      intro: [
        ['Bruno', 'A man without a car in this city is a tourist. Take the red one on the street.', 3.8],
        ['Rico', 'And if the owner objects?', 2.4],
        ['Bruno', 'Then drive faster than his objection.', 3],
      ],
      steps: [
        { type: 'steal', model: 'sport', x: spots.motel.x + 14, z: spots.motel.z + 10, text: 'Steal the sports car by the motel' },
        { type: 'drive', x: spots.garage.x, z: spots.garage.z, r: 6.5, text: 'Drive it to Bruno\u2019s garage' },
      ],
      outro: [
        ['Bruno', 'Look at you. Now go see Marisol at the club, she has envelopes that need collecting.', 3.8],
      ],
    },
    {
      id: 'rent',
      name: 'RENT MONEY',
      startAt: spots.club,
      reward: 320,
      intro: [
        ['Marisol', 'Rico. Bruno says you are useful. Three men in Little Habana stopped paying me.', 3.8],
        ['Marisol', 'Their envelopes are on the street. Pick them up before somebody else does.', 3.4],
      ],
      steps: [
        {
          type: 'collect',
          points: [
            { x: spots.habana.x, z: spots.habana.z },
            { x: spots.habana.x + 3, z: spots.habana.z + 62 },
            { x: spots.habana.x + 3, z: spots.habana.z + 128 },
          ],
          text: 'Collect Marisol\u2019s three envelopes',
          r: 2.6,
        },
        { type: 'goto', x: spots.club.x, z: spots.club.z, r: 3.4, text: 'Bring the money back to Marisol' },
      ],
      outro: [
        ['Marisol', 'Good. Now the ugly part. Los Cuervos are moving product through your old docks.', 3.8],
      ],
    },
    {
      id: 'docks',
      name: 'BAD BUSINESS',
      startAt: spots.club,
      reward: 450,
      intro: [
        ['Marisol', 'Four of them on the pier, watching the water like it is going to give them a tip.', 3.6],
        ['Rico', 'You want me to talk to them?', 2.2],
        ['Marisol', 'Talk with whatever you brought in that duffel bag.', 3],
      ],
      steps: [
        { type: 'kill', x: spots.docks.x, z: spots.docks.z, count: 4, radius: 26, text: 'Clear Los Cuervos out of the docks' },
      ],
      outro: [
        ['Marisol', 'That was the loud part. Now the cops know your face. Lose them.', 3.6],
      ],
    },
    {
      id: 'heat',
      name: 'HEAT',
      startAt: spots.docks,
      reward: 420,
      intro: [
        ['Marisol', 'You have a tail. Three cruisers and a bad attitude.', 3.2],
        ['Rico', 'Any advice?', 1.8],
        ['Marisol', 'Out of sight is out of mind. Nine seconds, Rico.', 3.2],
      ],
      onStart() {
        G.police.setWanted(3);
      },
      steps: [{ type: 'escape', text: 'Lose the PCPD — stay out of sight' }],
      outro: [['Marisol', 'Still breathing. Go home, I will call you.', 3]],
    },
    {
      id: 'courier',
      name: 'THE COURIER',
      startAt: spots.docks,
      reward: 700,
      intro: [
        ['Bruno', 'A blue van at the docks. It belongs to a man who is currently not paying attention.', 3.8],
        ['Bruno', 'Marina, north gate, before the tide turns or the buyer walks. Ninety seconds.', 3.6],
      ],
      steps: [
        { type: 'steal', model: 'van', x: spots.docks.x, z: spots.docks.z - 12, text: 'Steal the blue cargo van' },
        {
          type: 'drive',
          x: spots.marina.x,
          z: spots.marina.z,
          r: 8,
          limit: 100,
          text: 'Get the van to the marina',
          bonus: 250,
        },
      ],
      outro: [
        ['Bruno', 'Buyer is happy. There is heat on the tower though. Delgado wants to meet you.', 3.6],
      ],
    },
    {
      id: 'club',
      name: 'LA REINA',
      startAt: spots.club,
      reward: 900,
      intro: [
        ['Marisol', 'They came for me at my own club. On a Friday. With the velvet rope out.', 3.6],
        ['Rico', 'Where do you want me?', 2.2],
        ['Marisol', 'Front door. Nothing gets in. Nothing.', 2.8],
      ],
      steps: [
        {
          type: 'survive',
          seconds: 35,
          x: spots.club.x + 4,
          z: spots.club.z + 4,
          waves: 3,
          text: 'Hold the club entrance',
        },
      ],
      outro: [
        ['Marisol', 'Delgado gave the order. His tower, his penthouse, his last sunset.', 3.8],
        ['Marisol', 'Take the money, take a car, and do not come back to me with a fifth star in your pocket.', 3.8],
      ],
    },
    {
      id: 'last',
      name: 'LAST SUNSET',
      startAt: spots.club,
      reward: 2500,
      intro: [
        ['Rico', 'Delgado. You left me in a cell for eight years.', 3.2],
        ['Delgado', 'You were paid to be quiet. Quiet is a service, Salas.', 3.4],
        ['Rico', 'The service is closed.', 2.4],
      ],
      onStart() {
        G.police.setWanted(4);
      },
      steps: [
        { type: 'kill', x: spots.tower.x, z: spots.tower.z, count: 5, radius: 22, text: 'Fight up to Delgado\u2019s penthouse' },
        { type: 'escape', text: 'Get out of Solara with the money' },
      ],
      outro: [
        ['Bruno', 'Sunset, Rico. That is the whole city behind you.', 3.4],
      ],
    },
  ];

  const state = {
    index: 0,
    active: null,
    step: 0,
    stepT: 0,
    data: {},
    running: false,
    introQueue: [],
    introTimer: 0,
    outroTimer: 0,
    marker: null,
    availableMarkers: [],
    completed: [],
    failedRecently: 0,
    waveTimer: 0,
    wavesSpawned: 0,
  };

  function say(who, text, dur) {
    G.hud.subtitle(who, text, dur);
    G.audio.ui();
  }

  function queueIntro(lines) {
    state.introQueue = lines.slice();
    state.introTimer = 0.4;
  }

  function stepDefs() {
    return state.active ? state.active.steps : [];
  }

  function currentStep() {
    return stepDefs()[state.step] || null;
  }

  function setMarker(x, z) {
    state.marker = x === null ? null : { x, z };
  }

  // ---------------------------------------------------------------- step life
  function beginStep() {
    const step = currentStep();
    state.stepT = 0;
    state.data = {};
    if (!step) return finish(true);
    G.hud.setObjective(step.text, state.active.name);

    if (step.type === 'goto' || step.type === 'drive') setMarker(step.x, step.z);
    else if (step.type === 'steal') {
      setMarker(step.x, step.z);
      let car = G.vehicles.nearest(step.x, step.z, 40, (v) => !v.driver && v.ai === 'parked');
      if (!car) car = carAt(step.model || 'sport', step.x, step.z, 0);
      state.data.car = car;
      // light it up so the player can find it
      if (G.effects) G.effects.dust(new THREE.Vector3(car.pos.x, 0.6, car.pos.z));
    } else if (step.type === 'kill') {
      setMarker(step.x, step.z);
      state.data.enemies = [];
      for (let i = 0; i < step.count; i++) {
        const ang = (i / step.count) * TAU + Math.random() * 0.7;
        const r = 4 + Math.random() * (step.radius * 0.55);
        let ex = step.x + Math.cos(ang) * r;
        let ez = step.z + Math.sin(ang) * r;
        if (!city.isFree(ex, ez, 0.8)) {
          ex = step.x;
          ez = step.z;
        }
        const enemy = G.peds.spawnGang(ex, ez);
        enemy.state = 'hunt';
        state.data.enemies.push(enemy);
      }
      G.audio.wanted();
    } else if (step.type === 'collect') {
      state.data.collected = step.points.map(() => false);
      setMarker(step.points[0].x, step.points[0].z);
    } else if (step.type === 'escape') {
      setMarker(null);
      state.data.startWanted = G.police.wanted;
      if (state.data.startWanted === 0) G.police.setWanted(2);
    } else if (step.type === 'survive') {
      setMarker(step.x, step.z);
      state.wavesSpawned = 0;
      state.waveTimer = 1.2;
    }
  }

  function cleanupStep() {
    const step = currentStep();
    if (!step) return;
    if (step.type === 'kill' && state.data.enemies) {
      for (const e of state.data.enemies) {
        if (e.alive) G.peds.removePed(e);
      }
    }
  }

  function nextStep() {
    cleanupStep();
    state.step++;
    if (state.step >= stepDefs().length) finish(true);
    else beginStep();
  }

  // ---------------------------------------------------------------- mission life
  function start(def) {
    state.active = def;
    state.step = 0;
    state.running = true;
    state.marker = null;
    state.failedRecently = 0;
    state.lastStepBonus = 0;
    state.awaitStart = false;
    G.hud.setObjective('Listen', def.name);
    G.audio.missionStart();
    G.hud.showBig(def.name, 'MISSION STARTED', 2.6);
    queueIntro(def.intro || []);
    if (def.onStart) def.onStart();
  }

  function finish(success) {
    const def = state.active;
    if (!def) return;
    cleanupStep();
    state.running = false;
    state.marker = null;
    state.active = null;
    if (success) {
      let reward = def.reward;
      // time bonuses inside the final step
      const bonus = state.lastStepBonus || 0;
      reward += bonus;
      state.lastStepBonus = 0;
      G.state.money += reward;
      state.completed.push(def.id);
      state.index = Math.min(defs.length, state.index + 1);
      G.hud.setObjective(null);
      G.hud.showBig('MISSION PASSED', `${def.name} — $${reward}`, 3.4);
      G.audio.missionDone();
      G.audio.cash();
      G.stats.missions++;
      for (const [who, text, dur] of def.outro || []) {
        G.hud.subtitle(who, text, dur);
        break;
      }
      state.outroTimer = 4;
      state.outroLines = (def.outro || []).slice(1);
      if (G.save) G.save.save();
    } else {
      G.hud.setObjective(null);
      G.hud.showBig('MISSION FAILED', def.name, 3);
      state.failedRecently = def.id;
      state.active = null;
    }
  }

  function fail(reason = '') {
    state.lastFailReason = reason;
    if (state.running) finish(false);
  }

  // ---------------------------------------------------------------- update
  function checkStep(dt) {
    const step = currentStep();
    if (!step) return false;
    const p = G.player;
    const dist = (x, z) => Math.hypot(p.pos.x - x, p.pos.z - z);

    switch (step.type) {
      case 'goto':
        return dist(step.x, step.z) < (step.r ?? 3.2);
      case 'drive':
        if (step.limit && state.stepT > step.limit) {
          fail('out of time');
          return true;
        }
        if (dist(step.x, step.z) < (step.r ?? 6)) {
          if (!p.inVehicle) {
            G.hud.prompt(null);
            return false;
          }
          if (step.bonus) state.lastStepBonus = (state.lastStepBonus || 0) + step.bonus;
          return true;
        }
        return false;
      case 'steal':
        return p.inVehicle && p.inVehicle === state.data.car;
      case 'kill':
        return state.data.enemies.every((e) => !e.alive);
      case 'collect': {
        let done = 0;
        step.points.forEach((pt, i) => {
          if (!state.data.collected[i] && dist(pt.x, pt.z) < (step.r ?? 2.6)) {
            state.data.collected[i] = true;
            G.state.money += 40;
            G.audio.cash();
            G.hud.notify('Envelope collected  +$40', 1.6);
          }
          if (state.data.collected[i]) done++;
        });
        const nextPt = step.points.find((pt, i) => !state.data.collected[i]);
        if (nextPt) setMarker(nextPt.x, nextPt.z);
        return done === step.points.length;
      }
      case 'escape':
        if (state.stepT < 1) return false;
        return G.police.wanted === 0;
      case 'survive': {
        // keep the pressure on with waves of cartel shooters
        state.waveTimer -= dt;
        const alive = G.peds.list.filter((x) => x.kind === 'gang' && x.hostile && x.alive).length;
        if (state.waveTimer <= 0 && state.wavesSpawned < (step.waves ?? 3) && alive < 3) {
          state.waveTimer = 9;
          state.wavesSpawned++;
          for (let i = 0; i < 2; i++) {
            const ang = Math.random() * TAU;
            const r = 22 + Math.random() * 10;
            let ex = step.x + Math.cos(ang) * r;
            let ez = step.z + Math.sin(ang) * r;
            if (!city.isFree(ex, ez, 0.8)) {
              ex = step.x + 6;
              ez = step.z + 6;
            }
            const g = G.peds.spawnGang(ex, ez);
            g.state = 'hunt';
          }
        }
        return state.stepT > step.seconds;
      }
      default:
        return state.stepT > (step.seconds ?? 2);
    }
  }

  const api = {
    defs,
    state,
    get active() {
      return state.active;
    },
    get activeMarker() {
      return state.marker;
    },
    get availableMarkers() {
      if (state.running || state.index >= defs.length) return [];
      const def = defs[state.index];
      return [def.startAt];
    },
    get completed() {
      return state.completed;
    },
    start,
    fail,
    setMarker,
    // used by the save system
    restore(data) {
      if (!data) return;
      state.index = data.index ?? 0;
      state.completed = data.completed ?? [];
      state.active = null;
      state.running = false;
      state.step = 0;
      state.marker = null;
    },
    serialize() {
      return { index: state.index, completed: state.completed };
    },
    update(dt) {
      // intro chatter holds the mission before its first objective
      if (state.introQueue.length > 0) {
        state.introTimer -= dt;
        if (state.introTimer <= 0) {
          const [who, text, dur] = state.introQueue.shift();
          if (who || text) say(who, text, dur);
          state.introTimer = (dur ?? 3) + 0.3;
          if (state.introQueue.length === 0) state.awaitStart = true;
        }
        return;
      }
      if (state.awaitStart) {
        state.awaitStart = false;
        beginStep();
        return;
      }

      if (state.outroLines && state.outroLines.length) {
        state.outroTimer -= dt;
        if (state.outroTimer <= 0) {
          const [who, text, dur] = state.outroLines.shift();
          say(who, text, dur);
          state.outroTimer = (dur ?? 3) + 0.3;
        }
      }

      if (state.running) {
        state.stepT += dt;
        // straying too far from an objective fails the job
        const step = currentStep();
        if (step && (step.type === 'goto' || step.type === 'steal')) {
          const d = Math.hypot(G.player.pos.x - step.x, G.player.pos.z - step.z);
          // wandering right across the city for long abandons the job
          if (d > 320) {
            state.farTimer = (state.farTimer || 0) + dt;
            G.hud.prompt('Head back to the job', '!');
            if (state.farTimer > 30) {
              G.hud.notify('You walked out on the job — mission failed', 3);
              fail(`too far (${Math.round(d)} m for ${Math.round(state.farTimer)} s)`);
              return;
            }
          } else {
            state.farTimer = 0;
            G.hud.prompt(null);
          }
        }
        if (checkStep(dt)) {
          state.stepT = 0;
          nextStep();
        }
        return;
      }

      // trigger the next mission when Rico walks into the marker
      if (state.index < defs.length) {
        const def = defs[state.index];
        const p = G.player;
        const d = Math.hypot(p.pos.x - def.startAt.x, p.pos.z - def.startAt.z);
        if (d < 4.2 && !G.player.inVehicle) {
          start(def);
        }
      }
    },
  };

  return api;
}
