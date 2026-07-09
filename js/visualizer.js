// Visualizer — raw WebGL2 fullscreen fragment shaders, audio-reactive.
// One shared stack; each entry in SHADERS is a distinct GLSL look.
// Audio: lazy AnalyserNode tapped off Player.audio (createMediaElementSource,
// permanent per-element → guarded one-shot), analyser→destination so playback
// is unaffected. Album-derived color (UI._albumColor) drives the palette so the
// viz tints to the current cover, matching the rest of now-playing.
const Visualizer = {
  // Each fragment shader MUST begin with `#version 300 es`.
  SHADERS: [
    {
      name: 'spheres',
      fragment: `#version 300 es
precision highp float;
uniform float iTime;
uniform vec2 iResolution;
uniform float uBass, uMidLow, uMidHigh, uTreble, uLevel;
uniform vec3 uAlbumColor;
out vec4 fragColor;

float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0.0,0.0,0.0)), hash(i+vec3(1.0,0.0,0.0)), f.x),
                 mix(hash(i+vec3(0.0,1.0,0.0)), hash(i+vec3(1.0,1.0,0.0)), f.x), f.y),
             mix(mix(hash(i+vec3(0.0,0.0,1.0)), hash(i+vec3(1.0,0.0,1.0)), f.x),
                 mix(hash(i+vec3(0.0,1.0,1.0)), hash(i+vec3(1.0,1.0,1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a*noise(p); p = p*2.02; a *= 0.5; } return v; }

// Solid raymarched SDF sphere with fbm surface displacement — the "round 2"
// look. Depth comes from the shaded gradient; bass pumps the radius; mid
// ripples the displacement. Color is uAlbumColor, now fed by the working
// self-sampling pipeline (_sampleCoverColor), so it tracks the cover.
float map(vec3 p){
  float r = 1.0 + 1.5*uBass + 0.08*uLevel;
  float d = length(p) - r;
  float dispLow = (fbm(p*2.0 + vec3(11.3, 7.7, iTime*0.08)) - 0.5) * (0.03 + uMidLow*0.3);
  float dispHigh = (fbm(p*3.2 + vec3(4.2, 9.6, iTime*0.12)) - 0.5) * (0.02 + uMidHigh*0.2);
  float detail = (fbm(p*4.0 + vec3(17.1, iTime*0.4, 5.3)) - 0.5) * 0.22 * uTreble;
  return d + dispLow + dispHigh + detail;
}
vec3 calcNormal(vec3 p){ vec2 e = vec2(0.01, 0.0);
  return normalize(vec3(map(p+e.xyy)-map(p-e.xyy), map(p+e.yxy)-map(p-e.yxy), map(p+e.yyx)-map(p-e.yyx)));
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*iResolution.xy) / iResolution.y;
  vec3 ro = vec3(0.0, 0.0, -3.2);
  vec3 rd = normalize(vec3(uv, 1.6));
  vec3 C = uAlbumColor;
  vec3 col = C*0.04;
  float t = 0.0, glow = 0.0;
  bool hit = false;
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rd*t;
    float d = map(p);
    if (d < 0.001) { hit = true; break; }
    if (t > 6.0) break;
    glow += exp(-max(d, 0.0)*5.0) * 0.013;
    t += d;
  }
  if (hit) {
    vec3 p = ro + rd*t;
    vec3 n = calcNormal(p);
    float diff = 0.35 + 0.65*max(dot(n, normalize(vec3(0.6, 0.7, -0.8))), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 4.0) * 0.45;
    col = C*diff + rim*(C + vec3(0.3)) + C*0.12*uBass;
  }
  col += C * glow * (0.6 + uLevel*1.3);
  col = clamp(col, 0.0, 1.0);
  col = (col - 0.5) * 1.2 + 0.5;
  col = clamp(col, 0.0, 1.0);
  col = 1.0 - exp(-col * 1.1);
  float sh = pow(smoothstep(0.35, 0.95, fbm(vec3(uv * 1.5 + iTime * 0.05, iTime * 0.10))), 2.0) * (0.04 + uLevel * 0.14 + uBass * 0.08);
  col += col * sh + C * sh * 0.3;
  col = clamp(col, 0.0, 1.0);
  float scan = 0.95 + 0.05 * sin(gl_FragCoord.y * 1.5 + iTime * 4.0);
  float vig = 1.0 - 0.15 * dot(uv, uv * vec2(1.2, 1.0));
  float grain = (hash(vec3(gl_FragCoord.xy, iTime)) - 0.5) * 0.03;
  col = col * scan * vig + grain;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`
    }
  ],

  MINI_FRAGMENT: `#version 300 es
precision highp float;
uniform float iTime;
uniform vec2 iResolution;
uniform float uBass, uMidLow, uMidHigh, uTreble, uLevel;
uniform vec3 uAlbumColor;
out vec4 fragColor;

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*iResolution.xy) / iResolution.y;
  vec3 C = uAlbumColor;
  float radius = 0.22 + uBass * 0.18 + uLevel * 0.06;
  float d = length(uv);
  float disk = smoothstep(radius + 0.015, radius - 0.015, d);
  float shade = 1.0 - smoothstep(0.0, radius, d) * 0.5;
  float rim = pow(max(1.0 - d / radius, 0.0), 0.5) * 0.3;
  float halo = exp(-pow(max(d - radius, 0.0) * 8.0, 2.0)) * (0.2 + uLevel * 0.5);
  vec3 col = C * disk * shade + C * rim * disk + C * halo * 0.6 + C * (uTreble * 0.3 + uMidLow * 0.15) * disk;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,

  VERT: `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`,

  state: -1,        // -1 = off, >=0 = shader index
  gl: null,
  _audioReady: false,
  _bands: { bass: 0, midLow: 0, midHigh: 0, treble: 0, level: 0 },
  _miniBands: { bass: 0, midLow: 0, midHigh: 0, treble: 0, level: 0 },
  _miniFloor: { bass: 0, midLow: 0, midHigh: 0, treble: 0 },
  _color: null,

  init() {
    this.canvas = document.getElementById('np-viz-canvas');
    if (!this.canvas) return;
    this._miniCanvas = document.getElementById('np-corner-viz-canvas');
    if (this._miniCanvas) {
      this._miniCanvas.width = this._miniCanvas.height = 128;
    }
    this.btn = document.querySelector('.np-viz-btn');
    try {
      const p = JSON.parse(localStorage.getItem('musicapp:viz') || '{}');
      if (typeof p.which === 'number' && p.which >= 0 && p.which < this.SHADERS.length) this.state = p.which;
    } catch (e) {}
    if (this.btn) this.btn.addEventListener('click', () => this.cycle());
    const disc = document.querySelector('.np-artwork');
    if (disc) disc.addEventListener('click', (e) => {
      if (e.target.closest('.np-float-tray') || e.target.closest('.np-review-overlay')) return;
      this.cycle();
    });
    this._applyVisualState();
    // Safety net: if viz is on + now-playing visible but the loop died or
    // never rendered, restart it. Catches deep links, delayed layout, and
    // any path that doesn't explicitly call onShowNowPlaying.
    setInterval(() => {
      const np = document.getElementById('now-playing');
      if (!np || np.classList.contains('hidden')) return;
      if (this._raf == null || (this._lastRender && performance.now() - this._lastRender > 2000)) {
        this._stop();
        this._start();
      }
    }, 1000);
  },

  cycle() {
    const art = document.getElementById('np-art');
    const bg = document.getElementById('np-art-bg');
    if (art) art.style.setProperty('transition', 'opacity 0.35s ease', 'important');
    if (bg) bg.style.setProperty('transition', 'opacity 0.35s ease', 'important');
    this.state = (this.state < 0) ? 0 : -1;
    this._persist();
    this._applyVisualState();
    setTimeout(() => {
      if (art) art.style.removeProperty('transition');
      if (bg) bg.style.removeProperty('transition');
    }, 400);
  },

  _persist() {
    try { localStorage.setItem('musicapp:viz', JSON.stringify({ which: this.state })); } catch (e) {}
  },

  // DOM/visual only. GL start/stop is gated on now-playing visibility.
  _applyVisualState() {
    const on = this.state >= 0;
    const np = document.getElementById('now-playing');
    if (np) np.classList.toggle('viz-on', on);
    if (this.btn) this.btn.classList.toggle('active', on);
  },

  onShowNowPlaying() {
    this._start();
  },

  onHideNowPlaying() { this._stop(); },

  // --- GL lifecycle ---
  _compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn('[viz] shader compile fail:', gl.getShaderInfoLog(sh)); return null; }
    return sh;
  },

  _ensureGL() {
    if (this.gl) return true;
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) { console.warn('[viz] WebGL2 unavailable'); return false; }
    this.gl = gl;
    const vs = this._compile(gl.VERTEX_SHADER, this.VERT);
    if (!vs) return false;
    this._programs = this.SHADERS.map(s => {
      const fs = this._compile(gl.FRAGMENT_SHADER, s.fragment);
      if (!fs) return null;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('[viz] link fail:', gl.getProgramInfoLog(prog)); return null; }
      return {
        prog,
        loc: {
          aPos: gl.getAttribLocation(prog, 'aPos'),
          iTime: gl.getUniformLocation(prog, 'iTime'),
          iResolution: gl.getUniformLocation(prog, 'iResolution'),
          uBass: gl.getUniformLocation(prog, 'uBass'),
          uMidLow: gl.getUniformLocation(prog, 'uMidLow'),
          uMidHigh: gl.getUniformLocation(prog, 'uMidHigh'),
          uTreble: gl.getUniformLocation(prog, 'uTreble'),
          uLevel: gl.getUniformLocation(prog, 'uLevel'),
          uAlbumColor: gl.getUniformLocation(prog, 'uAlbumColor')
        }
      };
    });
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this._vbuf = buf;
    return true;
  },

  _ensureAudio() {
    if (this._audioReady) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const actx = new Ctx();
      const src = actx.createMediaElementSource(Player.audio);
      const an = actx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.5;
      src.connect(an);
      an.connect(actx.destination);
      this._actx = actx;
      this._analyser = an;
      this._freq = new Uint8Array(an.frequencyBinCount);
      this._wave = new Uint8Array(an.fftSize);
      this._audioReady = true;
    } catch (e) { console.warn('[viz] audio init failed:', e); }
  },

  // Band-level dynamics processor — replaces the old per-bin _preprocessFreq
  // (per-bin deviation amplified raw FFT noise). Operates on post-boost band
  // values, which are ~10-100x cleaner. Auto-range-normalizes each band against
  // its own recent min/max, and gates the expansion by a confidence measure so
  // flat/noisy content falls back to the raw band value (no flicker, no static
  // expansion). 8 slots: 0-3 full viz (b,ml,mh,tr), 4-7 mini (mb,mml,mmh,mtr).
  _bandDyn(slot, v, dt) {
    // ---- tunables ----
    const DECAY     = 4.0;    // vMax/vMin trailing time constant (s)
    const RANGE_LO  = 0.04;   // range-guard smoothstep lower bound
    const RANGE_HI  = 0.12;   // range-guard smoothstep upper bound
    const FLOOR_RNG = 0.04;   // min range in normalizer (avoids divide-by-noise)
    const GAMMA     = 1.4;    // shaping exponent on normalized value (n^GAMMA)
    const STRENGTH  = 0.8;    // confidence blend weight toward stretched signal
    const ATK_LOW   = 0.25;   // bass slots (0, 4) attack
    const REL_LOW   = 0.06;   // bass slots release
    const ATK_MID   = 0.5;    // other slots attack
    const REL_MID   = 0.10;   // other slots release
    // ------------------
    if (!this._bd) {
      this._bd = new Array(8);
      for (let i = 0; i < 8; i++) this._bd[i] = { vMin: 0, vMax: 0, sm: 0, init: false, needReset: false };
    }
    const s = this._bd[slot];
    if (!s.init || s.needReset) {           // first frame ever, or first frame after a seek
      s.vMin = s.vMax = s.sm = v;
      s.init = true; s.needReset = false;
      return v;
    }
    const decay = Math.exp(-dt / DECAY);     // trailing-bound move factor this frame
    // Range tracking: vMax instant-rise / slow-decay; vMin instant-drop / slow-rise.
    if (v > s.vMax) s.vMax = v; else s.vMax += (v - s.vMax) * (1 - decay);
    if (v < s.vMin) s.vMin = v; else s.vMin += (v - s.vMin) * (1 - decay);
    const isLow = slot === 0 || slot === 4;
    const rel = isLow ? REL_LOW : REL_MID;
    if (v < 0.01) {                          // silence → output 0, vMax still decays
      s.sm += (0 - s.sm) * rel;
      return s.sm;
    }
    const range = s.vMax - s.vMin;
    let ct = (range - RANGE_LO) / (RANGE_HI - RANGE_LO);   // confidence via smoothstep
    if (ct < 0) ct = 0; else if (ct > 1) ct = 1;
    const conf = ct * ct * (3 - 2 * ct);
    let n = (v - s.vMin) / (range > FLOOR_RNG ? range : FLOOR_RNG);
    if (n < 0) n = 0; else if (n > 1) n = 1;
    n = Math.pow(n, GAMMA);                  // shape: squash floor, preserve peaks
    const out = v + (n - v) * conf * STRENGTH;  // mix(v, n, conf*STRENGTH); no dynamics → raw
    const atk = isLow ? ATK_LOW : ATK_MID;
    s.sm += (out - s.sm) * (out > s.sm ? atk : rel);
    return s.sm;
  },

  _ensureMiniGL() {
    if (this._miniGL) return true;
    if (!this._miniCanvas) return false;
    const gl = this._miniCanvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) return false;
    this._miniGL = gl;
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const vs = mk(gl.VERTEX_SHADER, this.VERT);
    const fs = mk(gl.FRAGMENT_SHADER, this.MINI_FRAGMENT);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    this._miniProg = prog;
    this._miniLoc = {
      aPos: gl.getAttribLocation(prog, 'aPos'),
      iTime: gl.getUniformLocation(prog, 'iTime'),
      iResolution: gl.getUniformLocation(prog, 'iResolution'),
      uBass: gl.getUniformLocation(prog, 'uBass'),
      uMidLow: gl.getUniformLocation(prog, 'uMidLow'),
      uMidHigh: gl.getUniformLocation(prog, 'uMidHigh'),
      uTreble: gl.getUniformLocation(prog, 'uTreble'),
      uLevel: gl.getUniformLocation(prog, 'uLevel'),
      uAlbumColor: gl.getUniformLocation(prog, 'uAlbumColor')
    };
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this._miniVbuf = buf;
    return true;
  },

  // Kick the render loop only. The loop self-heals GL/audio/canvas-size each
  // frame (the old eager init here bailed permanently on a transient first-open
  // hiccup, leaving a blank canvas until the user toggled off→on).
  _start() {
    if (this._raf == null) this._loop();
  },

  _stop() {
    if (this._raf != null) { cancelAnimationFrame(this._raf); this._raf = null; }
  },

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wrap = this.canvas.parentElement;
    const size = Math.max(64, Math.min(wrap.clientWidth, 640));
    const px = Math.round(size * dpr);
    if (this.canvas.width !== px || this.canvas.height !== px) {
      this.canvas.width = px; this.canvas.height = px;
      this.gl.viewport(0, 0, px, px);
    }
  },

  _loop() {
    // Scheduler: always re-arms the next frame even if _frame throws, so a
    // transient first-open error can't permanently kill the render loop
    // (which left a blank canvas until the user toggled off→on).
    try { this._frame(); }
    catch (e) { console.warn('[viz] frame error:', e); }
    this._raf = requestAnimationFrame(() => this._loop());
  },

  _frame() {
    // Only route the <audio> element through Web Audio when the full viz is
    // explicitly ON. createMediaElementSource ties playback to the
    // AudioContext's state; on iOS/Android the context suspends on
    // background/lock, which pauses the media element and stops music. The
    // mini-viz (state < 0) is decorative — it renders flat rather than
    // breaking background playback.
    if (this.state >= 0) this._ensureAudio();
    if (this._actx && this._actx.state === 'suspended') this._actx.resume();
    if (this._t0 == null) this._t0 = performance.now() / 1000;

    // _bandDyn frame inputs: dt + seek-edge → mark all 8 slots for reset. Runs
    // every frame because _bandDyn isn't called during seek, so it can't see the edge.
    const _bdNow = performance.now();
    const dt = this._bdLastT ? Math.min(0.1, (_bdNow - this._bdLastT) / 1000) : 1 / 60;
    this._bdLastT = _bdNow;
    const _seeking = !!(Player.audio && Player.audio.seeking);
    if (this._bd && this._bdSeeking && !_seeking) for (let i = 0; i < 8; i++) this._bd[i].needReset = true;
    this._bdSeeking = _seeking;

    let b = 0, ml = 0, mh = 0, tr = 0;
    if (this._analyser && !(Player.audio && Player.audio.seeking)) {
      this._analyser.getByteFrequencyData(this._freq);
      for (let i = 0; i < 12; i++) b += this._freq[i];
      for (let i = 12; i < 40; i++) ml += this._freq[i];
      for (let i = 40; i < 72; i++) mh += this._freq[i];
      for (let i = 72; i < 200; i++) tr += this._freq[i];
      b /= 12 * 255; ml /= 28 * 255; mh /= 32 * 255; tr /= 128 * 255;
      b = Math.max(0, Math.min(1, b * 2.5 - 0.01)); ml = Math.max(0, Math.min(1, ml * 1.4 - 0.01)); mh = Math.max(0, Math.min(1, mh * 1.2 - 0.01)); tr = Math.max(0, Math.min(1, tr * 2.2 - 0.01));
      b = this._bandDyn(0, b, dt); ml = this._bandDyn(1, ml, dt); mh = this._bandDyn(2, mh, dt); tr = this._bandDyn(3, tr, dt);
    }
    const follow = (cur, prev, atk, rel) => {
      if (cur > prev) return prev + (cur - prev) * atk;
      const dynRel = Math.min(0.85, rel * (1 + prev * 3));
      return prev + (cur - prev) * dynRel;
    };
    this._bands.bass = follow(b, this._bands.bass, 0.9, 0.18);
    this._bands.midLow = follow(ml, this._bands.midLow, 0.5, 0.30);
    this._bands.midHigh = follow(mh, this._bands.midHigh, 0.55, 0.22);
    this._bands.treble = follow(tr, this._bands.treble, 0.78, 0.3);
    const lvl = (this._bands.bass + this._bands.midLow + this._bands.midHigh + this._bands.treble) / 4;
    this._bands.level = follow(lvl, this._bands.level, 0.5, 0.2);

    this._sampleCoverColor();
    let cr = 0.83, cg = 0.94, cb = 0.25;
    if (this._color) {
      if (!this._colorCur) this._colorCur = this._color.slice();
      const k = 0.06;
      this._colorCur[0] += (this._color[0] - this._colorCur[0]) * k;
      this._colorCur[1] += (this._color[1] - this._colorCur[1]) * k;
      this._colorCur[2] += (this._color[2] - this._colorCur[2]) * k;
      cr = this._colorCur[0]; cg = this._colorCur[1]; cb = this._colorCur[2];
    }

    if (this.state >= 0) {
      const sIdx = this.state;
      if (!this._ensureGL() || !this._programs || !this._programs[sIdx]) { this._lastRender = performance.now(); return; }
      const gl = this.gl;
      const wrap = this.canvas.parentElement;
      if (!wrap || wrap.clientWidth < 2) { this._lastRender = performance.now(); return; }
      this._resize();
      const p = this._programs[sIdx];
      gl.useProgram(p.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vbuf);
      gl.enableVertexAttribArray(p.loc.aPos);
      gl.vertexAttribPointer(p.loc.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(p.loc.iTime, (performance.now() / 1000) - this._t0);
      gl.uniform2f(p.loc.iResolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(p.loc.uBass, this._bands.bass);
      gl.uniform1f(p.loc.uMidLow, this._bands.midLow);
      gl.uniform1f(p.loc.uMidHigh, this._bands.midHigh);
      gl.uniform1f(p.loc.uTreble, this._bands.treble);
      gl.uniform1f(p.loc.uLevel, this._bands.level);
      gl.uniform3f(p.loc.uAlbumColor, cr, cg, cb);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else if (this._miniCanvas && this._ensureMiniGL()) {
      let mb = 0, mml = 0, mmh = 0, mtr = 0;
      if (this._freq) {
        for (let i = 2; i < 6; i++) mb += this._freq[i];
        for (let i = 6; i < 35; i++) mml += this._freq[i];
        for (let i = 35; i < 93; i++) mmh += this._freq[i];
        for (let i = 93; i < Math.min(232, this._freq.length); i++) mtr += this._freq[i];
        mb = Math.pow(Math.min(1, mb / (4 * 255) * 1.2), 0.65);
        mml = Math.pow(Math.min(1, mml / (29 * 255) * 1.0), 0.65);
        mmh = Math.pow(Math.min(1, mmh / (58 * 255) * 1.0), 0.65);
        mtr = Math.pow(Math.min(1, mtr / (Math.min(139, this._freq.length - 93) * 255) * 1.5), 0.65);
      }
      const mf = (cur, prev, atk, rel) => cur > prev ? prev + (cur - prev) * atk : prev + (cur - prev) * rel;
      this._miniBands.bass = mf(this._bandDyn(4, mb, dt), this._miniBands.bass, 0.7, 0.12);
      this._miniBands.midLow = mf(this._bandDyn(5, mml, dt), this._miniBands.midLow, 0.5, 0.15);
      this._miniBands.midHigh = mf(this._bandDyn(6, mmh, dt), this._miniBands.midHigh, 0.55, 0.17);
      this._miniBands.treble = mf(this._bandDyn(7, mtr, dt), this._miniBands.treble, 0.7, 0.19);
      const mlvl = (this._miniBands.bass + this._miniBands.midLow + this._miniBands.midHigh + this._miniBands.treble) / 4;
      this._miniBands.level = mf(mlvl, this._miniBands.level, 0.5, 0.12);
      const gl = this._miniGL;
      const w = this._miniCanvas.width, h = this._miniCanvas.height;
      gl.viewport(0, 0, w, h);
      gl.useProgram(this._miniProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._miniVbuf);
      gl.enableVertexAttribArray(this._miniLoc.aPos);
      gl.vertexAttribPointer(this._miniLoc.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(this._miniLoc.iTime, (performance.now() / 1000) - this._t0);
      gl.uniform2f(this._miniLoc.iResolution, w, h);
      gl.uniform1f(this._miniLoc.uBass, this._miniBands.bass);
      gl.uniform1f(this._miniLoc.uMidLow, this._miniBands.midLow);
      gl.uniform1f(this._miniLoc.uMidHigh, this._miniBands.midHigh);
      gl.uniform1f(this._miniLoc.uTreble, this._miniBands.treble);
      gl.uniform1f(this._miniLoc.uLevel, this._miniBands.level);
      gl.uniform3f(this._miniLoc.uAlbumColor, 0.8, 0.8, 0.8);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this._lastRender = performance.now();
  },

  // Called by UI._applyNowPlayingBg when a cover's dominant color is computed
  // (push, not poll) — fires on every album change so the viz retints immediately.
  // r,g,b in 0..1. Apply the SAME vivid transform as the scrubber/waveform
  // (vibS = s+35, vibL = clamp(l+10,45,65)) so the viz matches the rest of
  // now-playing instead of showing the raw (often dark/muted) cover color.
  setColor(r, g, b) {
    const [h, s, l] = this._rgbToHsl(r, g, b);
    const vibS = Math.min(100, s + 42);
    const vibL = Math.min(68, Math.max(48, l + 12));
    this._color = this._hslToRgb(h, vibS, vibL);
  },
  // Self-sufficient color source: sample the live album cover (#np-art, same-origin)
  // directly and derive the dominant RGB ourselves. UI._albumColor turned out to be
  // null at render time (nulled on hide, async-populated), so push/poll never landed
  // and the viz stayed on the lime fallback. Sampling the img is robust to all that
  // and retints the moment a new cover loads.
  _sampleCoverColor() {
    const img = document.getElementById('np-art');
    if (!img || !img.complete || !img.naturalWidth) return;
    if (this._artSrc === img.src) return;
    this._artSrc = img.src;
    try {
      if (!this._samp) this._samp = document.createElement('canvas');
      this._samp.width = this._samp.height = 8;
      const ctx = this._samp.getContext('2d');
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      this.setColor(r / (n * 255), g / (n * 255), b / (n * 255));
      console.log('[viz-color] sample →', this._color);
    } catch (e) { /* CORS/not-ready: keep prior color */ }
  },
  _rgbToHsl(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h, s, l = (mx + mn) / 2;
    if (mx === mn) { h = 0; s = 0; }
    else {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d) + (g < b ? 6 : 0);
      else if (mx === g) h = ((b - r) / d) + 2;
      else h = ((r - g) / d) + 4;
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  },
  _hslToRgb(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360; s /= 100; l /= 100;
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    return [f(h + 1/3), f(h), f(h - 1/3)];
  }
};
