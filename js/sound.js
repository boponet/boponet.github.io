/* Sound. Everything is synthesised with Web Audio; there are no audio files.
   Each sound is rendered once into a buffer when audio first wakes, then played back from that
   buffer, so it sounds exactly the same every time. (Scheduling short envelopes live drifts: if the
   audio thread picks a note up a few ms late, the note starts partway down its fade and comes out
   quieter.) */
(function () {
  // Per-sound level trims in dB, from a loudness pass (approximate K-weighting, 200 ms windows) that
  // brings every sound to about -40. Two are set lower: the leave sound (about -46), because it plays
  // 52 times in quick succession during the deal, so the stream as a whole lands near -40; and the
  // hover tick (about -50), because it plays every time the pointer crosses a button.
  const TRIM_DB = { pick: 1, drop: -3, back: -0.5, locked: 2.5, click: 10, deal: -3.5, leave: 10.5, win: -5, hover: 0 };
  // overall level: the loudest sound (the click) peaks around -7 dBFS, leaving room for overlaps
  const LEVEL = 2.45;
  const PENT = [659.25, 739.99, 830.61, 987.77, 1108.73, 1318.51, 1479.98, 1661.22, 1975.53, 2217.46];   // E major pentatonic
  const FIFTH = Math.pow(2, 7 / 12);
  // seconds of audio to render for each sound, tails included
  const LENGTH = { pick: .9, drop: 1.4, back: 1.4, locked: .6, click: .9, deal: 2.8, leave: .4, win: 3.2, hover: .5 };

  // lead: how far ahead of "now" notes are scheduled (0 when rendering offline)
  function createEngine(ac, destination, level = LEVEL, lead = .005) {
    const master = ac.createGain();
    master.gain.value = level;
    master.connect(destination);

    const echo = (time, feedback, cutoff, send) => {
      const input = ac.createGain(), dl = ac.createDelay(1), fb = ac.createGain(), lp = ac.createBiquadFilter();
      input.gain.value = send; dl.delayTime.value = time; fb.gain.value = feedback; lp.type = 'lowpass'; lp.frequency.value = cutoff;
      input.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(master);
      return input;
    };
    const buses = {
      1: echo(.085, .32, 3200, .28),   // the short glass echo
      2: echo(.17, .36, 2600, .3),     // the long echo: restart and win
      3: echo(.085, .14, 3200, .28)    // same timing, dies after a repeat or two: pick-up
    };
    // seeded noise, so the leave sound is identical every time
    const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const ch = noise.getChannelData(0);
    let seed = 20000;
    for (let i = 0; i < ch.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; ch[i] = seed / 2147483648 - 1; }

    let trim = 1;
    function shape(g, t0, a, d, peak, soft) {
      g.gain.setValueAtTime(.0001, t0);
      if (soft) g.gain.linearRampToValueAtTime(peak, t0 + a);
      else g.gain.exponentialRampToValueAtTime(peak, t0 + a);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + a + d);
    }
    function out(g, wet, bus) {
      g.connect(master);
      if (wet) { const w = ac.createGain(); w.gain.value = wet; g.connect(w); w.connect(buses[bus || 1]); }
    }
    // a pitched blip with an optional lowpass and echo send
    function tone({ type = 'sine', f, t = 0, a = .003, d = .1, peak = .15, lp, wet = 0, soft, bus }) {
      const t0 = ac.currentTime + lead + t, end = t0 + a + d + .05;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0);
      shape(g, t0, a, d, peak * trim, soft);
      let n = o;
      if (lp) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); n = fl; }
      n.connect(g); out(g, wet, bus);
      o.start(t0); o.stop(end);
    }
    // a burst of band-passed noise, optionally sweeping its filter
    function hiss({ t = 0, a = .003, d = .06, peak = .2, f = 2000, to, q = 1, soft }) {
      const t0 = ac.currentTime + lead + t;
      const src = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noise;
      fl.type = 'bandpass'; fl.Q.value = q; fl.frequency.setValueAtTime(f, t0);
      if (to) fl.frequency.exponentialRampToValueAtTime(to, t0 + a + d);
      shape(g, t0, a, d, peak * trim, soft);
      src.connect(fl); fl.connect(g); out(g);
      src.start(t0, .25); src.stop(t0 + a + d + .05);
    }

    const SOUNDS = {
      pick: () => { tone({ f: 1760, d: .05, peak: .14, wet: .5, bus: 3 }); tone({ f: 3520, d: .03, peak: .04, wet: .5, bus: 3 }); },
      drop: () => { tone({ f: 1318.5, d: .12, peak: .16, wet: .5 }); tone({ f: 659.25, d: .1, peak: .07 }); },
      back: () => { tone({ f: 987.77, d: .07, peak: .12, wet: .4 }); tone({ f: 739.99, t: .06, d: .1, peak: .12, wet: .4 }); },
      locked: () => { tone({ f: 330, d: .04, peak: .14, lp: 1500 }); tone({ f: 330, t: .07, d: .04, peak: .1, lp: 1500 }); },
      click: () => tone({ f: 2637, d: .025, peak: .06, wet: .3 }),
      // the pointer moving onto something that lights up white: a small, soft tick below the click
      hover: () => tone({ f: 1975.53, a: .025, d: .035, peak: .03, wet: .25, bus: 3, soft: true }),
      // restart: an E and the fifth above, each doubled a hair apart, swelling through the long echo
      deal: () => [[659.25, .1], [659.25 * FIFTH, .07]].forEach(([f, peak]) => {
        const v = { a: .1, d: .4, peak: peak * .6, wet: .6, soft: true, bus: 2 };
        tone({ ...v, f: f * 1.003 }); tone({ ...v, f: f / 1.003 });
      }),
      // a card coming off the stack: a narrow band of noise rising as it fades in
      leave: () => hiss({ f: 1200, to: 2600, q: 1.6, a: .035, d: .07, peak: .06, soft: true }),
      // one note per ring of the win wave, rising through the scale
      win: rings => rings.forEach(({ i, t }) => {
        const f = PENT[Math.min(i, PENT.length - 1)];
        tone({ f: f * 1.003, t, d: .3, peak: .045, wet: .6, bus: 2 });
        tone({ f: f / 1.003, t, d: .3, peak: .045, wet: .6, bus: 2 });
      })
    };

    return {
      play(name, arg) {
        const fn = SOUNDS[name];
        if (!fn) return;
        trim = Math.pow(10, (TRIM_DB[name] || 0) / 20);
        fn(arg);
        trim = 1;
      }
    };
  }

  // render one sound into a buffer, exactly as it would play live
  function render(name, arg, sampleRate) {
    const off = new OfflineAudioContext(1, Math.ceil(sampleRate * LENGTH[name]), sampleRate);
    createEngine(off, off.destination, LEVEL, 0).play(name, arg);
    return off.startRendering();
  }
  const cacheKey = (name, arg) => name === 'win' ? 'win:' + arg.map(x => x.i).join(',') : name;

  // Browsers keep audio asleep until the first click or key. Anything asked for before then is
  // dropped rather than queued, so nothing piles up and plays all at once when audio wakes.
  let ac = null, live = null, out = null, muted = false, volume = .85;
  // The slider is even in decibels, which is close to how loudness is heard: every 10% step is
  // 2.7 dB, from full level at 100% to -24 dB at 10%. Below 10% it fades the rest of the way to
  // silence. The range is kept narrow because the sounds are soft; much lower and they vanish.
  const RANGE_DB = 24, FLOOR = .1;
  const dbCurve = v => Math.pow(10, (v - 1) / (1 - FLOOR) * RANGE_DB / 20);
  const gainFor = v => v >= FLOOR ? dbCurve(v) : dbCurve(FLOOR) * v / FLOOR;
  const buffers = {}, pendingRenders = {};
  function wake() {
    const ua = navigator.userActivation;
    if (ua && !ua.hasBeenActive) return Promise.resolve(false);
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return Promise.resolve(false);
      ac = new AC();
      out = ac.createGain(); out.gain.value = gainFor(volume);
      // a safety limiter just under full scale, in case several sounds stack up at once
      const limit = ac.createDynamicsCompressor();
      limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = .002; limit.release.value = .1;
      out.connect(limit); limit.connect(ac.destination);
      live = createEngine(ac, out, LEVEL, .02);
      Object.keys(LENGTH).filter(n => n !== 'win').forEach(n => prepare(n));
    }
    if (ac.state === 'running') return Promise.resolve(true);
    if (!ua || ua.isActive) return ac.resume().then(() => true, () => false);   // only wake from a real click or key
    return Promise.resolve(false);
  }
  function prepare(name, arg) {
    const key = cacheKey(name, arg);
    if (!pendingRenders[key]) pendingRenders[key] = render(name, arg, ac.sampleRate).then(b => (buffers[key] = b), () => null);
    return pendingRenders[key];
  }
  function playBuffer(b) {
    const src = ac.createBufferSource();
    src.buffer = b; src.connect(out); src.start();
  }

  window.Sound = {
    createEngine, render, TRIM_DB,
    play(name, arg) {
      if (muted) return;
      const woke = wake();
      woke.then(ok => {
        if (!ok) return;
        const b = buffers[cacheKey(name, arg)];
        if (b) return playBuffer(b);
        // not rendered yet: the win waits for its render (a few ms); anything else plays live this once
        if (name === 'win') prepare(name, arg).then(x => { if (x && !muted) playBuffer(x); });
        else live.play(name, arg);
      });
    },
    setMuted(m) { muted = !!m; },
    isMuted() { return muted; },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (out) out.gain.value = gainFor(volume); },
    getVolume() { return volume; }
  };
})();
