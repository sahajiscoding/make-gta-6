// All sound is synthesised at run time with the Web Audio API: engine notes,
// sirens, gunfire, footsteps, city ambience and three original radio stations.
// No audio files, nothing fetched.
export function createAudio() {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let ambientBus = null;
  let noiseBuffer = null;
  let engine = null;
  let skid = null;
  let siren = null;
  let station = -1;
  let musicTimer = null;
  let nextNoteTime = 0;
  let step = 0;
  const volume = { master: 0.8, music: 0.5, sfx: 0.85 };

  const now = () => ctx.currentTime;

  function makeNoise(seconds = 1) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function noiseSource(loop = false) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = loop;
    return src;
  }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume.master;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = volume.sfx;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(master);
    ambientBus = ctx.createGain();
    ambientBus.gain.value = 0.5;
    ambientBus.connect(master);
    noiseBuffer = makeNoise(2);
    startAmbient();
    // start on the first station once the graph exists
    if (typeof api !== 'undefined') api.setStation(0);
  }

  function resume() {
    init();
    if (ctx.state === 'suspended') ctx.resume();
  }

  // ---------------------------------------------------------------- ambience
  function startAmbient() {
    const hum = noiseSource(true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    hum.connect(lp).connect(g).connect(ambientBus);
    hum.start();
    // slow city swell
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
  }

  // ---------------------------------------------------------------- engine
  function startEngine() {
    if (!ctx || engine) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 30;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 6;
    const g = ctx.createGain();
    g.gain.value = 0;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    osc.connect(filter);
    osc2.connect(g2).connect(filter);
    filter.connect(g).connect(sfxBus);
    osc.start();
    osc2.start();
    engine = { osc, osc2, filter, gain: g };
  }

  function stopEngine() {
    if (!engine) return;
    try {
      engine.osc.stop();
      engine.osc2.stop();
    } catch {
      /* already stopped */
    }
    engine = null;
  }

  // ---------------------------------------------------------------- sfx
  function blip(freq, dur, type = 'square', gain = 0.15, slideTo = null) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now());
    g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, now() + dur);
    o.connect(g).connect(sfxBus);
    o.start();
    o.stop(now() + dur + 0.02);
  }

  function noiseBurst(dur, filterFreq, gain = 0.3, type = 'lowpass', sweepTo = null) {
    if (!ctx) return;
    const src = noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, now() + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now());
    g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
    src.connect(f).connect(g).connect(sfxBus);
    src.start();
    src.stop(now() + dur + 0.02);
  }

  const api = {
    resume,
    get ready() {
      return !!ctx;
    },
    setVolume(kind, v) {
      volume[kind] = v;
      if (!ctx) return;
      if (kind === 'master') master.gain.value = v;
      if (kind === 'music') musicBus.gain.value = station >= 0 ? v : 0;
      if (kind === 'sfx') sfxBus.gain.value = v;
    },
    getVolume: (kind) => volume[kind],

    // engine note follows speed and throttle
    engine(on, rpm, throttle) {
      if (!ctx) return;
      if (on && !engine) startEngine();
      if (!on && engine) {
        stopEngine();
        return;
      }
      if (!engine) return;
      const f = 42 + rpm * 165;
      engine.osc.frequency.setTargetAtTime(f, now(), 0.06);
      engine.osc2.frequency.setTargetAtTime(f * 0.5, now(), 0.06);
      engine.filter.frequency.setTargetAtTime(420 + rpm * 2100 + throttle * 500, now(), 0.08);
      engine.gain.gain.setTargetAtTime(0.075 + throttle * 0.07 + rpm * 0.04, now(), 0.1);
    },

    skid(on, amount = 1) {
      if (!ctx) return;
      if (on && !skid) {
        const src = noiseSource(true);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1900;
        f.Q.value = 1.6;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(f).connect(g).connect(sfxBus);
        src.start();
        skid = { src, f, g };
      }
      if (skid) skid.g.gain.setTargetAtTime(on ? 0.09 * amount : 0, now(), 0.05);
    },

    siren(on) {
      if (!ctx) return;
      if (on && !siren) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 820;
        const lfo = ctx.createOscillator();
        lfo.type = 'square';
        lfo.frequency.value = 1.15;
        const depth = ctx.createGain();
        depth.gain.value = 260;
        lfo.connect(depth).connect(o.frequency);
        const g = ctx.createGain();
        g.gain.value = 0;
        o.connect(g).connect(sfxBus);
        o.start();
        lfo.start();
        siren = { o, lfo, g };
      }
      if (siren) siren.g.gain.setTargetAtTime(on ? 0.035 : 0, now(), 0.12);
    },

    gunshot(kind = 'pistol') {
      if (!ctx) return;
      if (kind === 'shotgun') {
        noiseBurst(0.28, 1600, 0.5, 'lowpass', 240);
        blip(90, 0.2, 'sine', 0.3, 40);
      } else if (kind === 'smg') {
        noiseBurst(0.1, 4200, 0.28, 'highpass', 900);
        blip(180, 0.07, 'square', 0.16, 90);
      } else {
        noiseBurst(0.16, 3000, 0.36, 'bandpass', 500);
        blip(140, 0.1, 'square', 0.2, 70);
      }
    },
    punch() {
      noiseBurst(0.09, 420, 0.3);
      blip(70, 0.08, 'sine', 0.22, 45);
    },
    impact(strength = 1) {
      noiseBurst(0.2 + strength * 0.1, 500, 0.18 + strength * 0.25, 'lowpass', 120);
      blip(58, 0.16, 'sine', 0.16 * strength, 34);
    },
    footstep(sprint) {
      noiseBurst(0.06, sprint ? 900 : 620, sprint ? 0.1 : 0.06, 'bandpass');
    },
    horn() {
      blip(392, 0.35, 'square', 0.09);
      blip(494, 0.35, 'square', 0.07);
    },
    cash() {
      blip(880, 0.09, 'triangle', 0.13);
      setTimeout(() => blip(1320, 0.12, 'triangle', 0.13), 70);
    },
    ui(up = true) {
      blip(up ? 620 : 420, 0.06, 'square', 0.06);
    },
    pickup() {
      [660, 880, 1180].forEach((f, i) => setTimeout(() => blip(f, 0.12, 'triangle', 0.11), i * 60));
    },
    hitMarker() {
      blip(1500, 0.05, 'square', 0.07);
    },
    damage() {
      noiseBurst(0.24, 240, 0.3, 'lowpass');
      blip(120, 0.22, 'sawtooth', 0.13, 60);
    },
    death() {
      blip(180, 0.9, 'sawtooth', 0.16, 40);
    },
    missionStart() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.12), i * 110));
    },
    missionDone() {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'triangle', 0.13), i * 130));
    },
    wanted() {
      blip(300, 0.3, 'sawtooth', 0.09, 700);
    },
    heli(on) {
      if (on) noiseBurst(0.4, 220, 0.12, 'lowpass');
    },

    // ------------------------------------------------------------ radio
    get station() {
      return station;
    },
    get stationName() {
      return STATIONS[station]?.name ?? 'Radio off';
    },
    setStation(i) {
      if (!ctx) return;
      station = i;
      musicBus.gain.setTargetAtTime(volume.music, now(), 0.2);
      step = 0;
      nextNoteTime = now() + 0.1;
      if (musicTimer) clearInterval(musicTimer);
      musicTimer = setInterval(schedule, 90);
    },
    radioOff() {
      station = -1;
      if (ctx) musicBus.gain.setTargetAtTime(0, now(), 0.15);
      if (musicTimer) clearInterval(musicTimer);
      musicTimer = null;
    },
    nextStation() {
      setStation((station + 1) % STATIONS.length);
      return STATIONS[station].name;
    },
    update(dt, state) {
      if (!ctx) return;
      ambientBus.gain.setTargetAtTime(0.35 + (state?.night ?? 0) * 0.15, now(), 0.5);
    },
  };

  // -------------------------------------------------------------- radio engine
  const STATIONS = [
    {
      name: 'Solara Sabor 98.1',
      bpm: 96,
      scale: [0, 2, 3, 5, 7, 8, 10],
      root: 220,
      bass: 'sawtooth',
      lead: 'triangle',
      drums: 'latin',
      prog: [0, 5, 3, 4],
    },
    {
      name: 'Neon 88.5',
      bpm: 118,
      scale: [0, 2, 3, 5, 7, 9, 10],
      root: 196,
      bass: 'square',
      lead: 'sawtooth',
      drums: 'four',
      prog: [0, 3, 5, 4],
    },
    {
      name: 'Vacilón 104.7',
      bpm: 92,
      scale: [0, 2, 4, 5, 7, 9, 11],
      root: 174,
      bass: 'square',
      lead: 'square',
      drums: 'dembow',
      prog: [0, 4, 5, 3],
    },
  ];

  function midiToFreq(semi, root) {
    return root * Math.pow(2, semi / 12);
  }

  function tone(freq, time, dur, type, gain, bus, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(bus);
    o.start(time);
    o.stop(time + dur + 0.03);
  }

  function perc(time, kind, gain) {
    const src = noiseSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    if (kind === 'kick') {
      f.type = 'lowpass';
      f.frequency.value = 140;
      g.gain.setValueAtTime(gain * 1.6, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(120, time);
      o.frequency.exponentialRampToValueAtTime(45, time + 0.15);
      const og = ctx.createGain();
      og.gain.setValueAtTime(gain * 1.3, time);
      og.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
      o.connect(og).connect(musicBus);
      o.start(time);
      o.stop(time + 0.2);
    } else if (kind === 'snare') {
      f.type = 'highpass';
      f.frequency.value = 1400;
      g.gain.setValueAtTime(gain, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.13);
    } else {
      f.type = 'highpass';
      f.frequency.value = 5200;
      g.gain.setValueAtTime(gain * 0.5, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    }
    src.connect(f).connect(g).connect(musicBus);
    src.start(time);
    src.stop(time + 0.2);
  }

  function schedule() {
    if (!ctx || station < 0) return;
    const st = STATIONS[station];
    const spb = 60 / st.bpm;
    const sixteenth = spb / 4;
    while (nextNoteTime < now() + 0.25) {
      const bar = Math.floor(step / 16) % 4;
      const chordRoot = st.prog[bar];
      const s = step % 16;
      // bass
      if (s % 4 === 0 || s === 6 || s === 10) {
        tone(midiToFreq(chordRoot - 12, st.root), nextNoteTime, sixteenth * 3, st.bass, 0.05, musicBus);
      }
      // chord pad every bar
      if (s === 0) {
        [0, 4, 7].forEach((iv, i) =>
          tone(midiToFreq(chordRoot + iv, st.root), nextNoteTime, spb * 1.9, 'sine', 0.022, musicBus, i * 6)
        );
      }
      // lead arpeggio
      if (s % 2 === 0) {
        const deg = st.scale[(step * 3 + bar) % st.scale.length];
        tone(midiToFreq(deg + 12 + chordRoot, st.root), nextNoteTime, sixteenth * 1.4, st.lead, 0.03, musicBus);
      }
      // drums
      if (st.drums === 'four') {
        if (s % 4 === 0) perc(nextNoteTime, 'kick', 0.16);
        if (s % 8 === 4) perc(nextNoteTime, 'snare', 0.1);
        if (s % 2 === 1) perc(nextNoteTime, 'hat', 0.05);
      } else if (st.drums === 'dembow') {
        if (s === 0 || s === 6 || s === 8 || s === 14) perc(nextNoteTime, 'kick', 0.15);
        if (s === 3 || s === 11) perc(nextNoteTime, 'snare', 0.09);
        if (s % 2 === 0) perc(nextNoteTime, 'hat', 0.04);
      } else {
        if (s === 0 || s === 6 || s === 10) perc(nextNoteTime, 'kick', 0.13);
        if (s === 4 || s === 12) perc(nextNoteTime, 'snare', 0.08);
        if (s % 3 === 0) perc(nextNoteTime, 'hat', 0.05);
      }
      step++;
      nextNoteTime += sixteenth;
    }
  }

  return api;
}
