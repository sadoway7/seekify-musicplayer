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
uniform float uRadAmt, uRadBase, uRadSrc;
uniform float uWobLo, uWobHi, uDet, uGlowAmt, uFlash;
uniform float uWobLoSrc, uWobHiSrc, uDetSrc, uGlowSrc, uFlashSrc, uRimSrc, uShimSrc;
uniform float uRimPow, uRimStr, uShimBase, uShimLvl, uShimBass, uShimColor;
uniform float uScanAmt, uVigAmt, uGrainAmt, uAmbient, uDiffBase, uDiffAmt, uGlowAcc, uRadLvl;
uniform float uWobBaseLo, uWobBaseHi;
uniform float uContrast, uExposure;
uniform float uContrastSrc, uExposureSrc, uGrainSrc, uScanSrc, uVigSrc, uAmbientSrc, uDiffSrc, uRadLvlSrc;
uniform float uCamDist, uCamFov, uMaxDist, uHitEps, uGlowBase, uShimPow, uShimLo, uShimHi;
uniform float uWobFreqLo, uWobFreqHi, uDetFreq, uWobTimeLo, uWobTimeHi, uDetTime;
uniform float uScanFreq, uScanTime, uVigX, uVigY, uLightX, uLightY, uLightZ;
uniform int uMaxSteps;
uniform vec3 uAlbumColor;
uniform vec2 uCenter;   // sphere screen-center offset (uv units) → aligns sphere to disc

out vec4 fragColor;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.02;
    a *= 0.5;
  }
  return v;
}

// Source selector: 0=Normal(0.0), 1=Bass, 2=MidLow, 3=MidHigh, 4=Treble, 5=Level
float bandSel(float src) {
  if (src < 0.5) return 0.0;
  if (src < 1.5) return uBass;
  if (src < 2.5) return uMidLow;
  if (src < 3.5) return uMidHigh;
  if (src < 4.5) return uTreble;
  return uLevel;
}

float map(vec3 p) {
  float drv = bandSel(uRadSrc);
  float radMod = bandSel(uRadLvlSrc);
  float r = uRadBase + uRadAmt * drv + uRadLvl * (uLevel + radMod);
  float d = length(p) - r;
  float dispLow  = (fbm(p * uWobFreqLo + vec3(11.3, 7.7, iTime * uWobTimeLo)) - 0.5)
                   * (uWobBaseLo + bandSel(uWobLoSrc) * uWobLo);
  float dispHigh = (fbm(p * uWobFreqHi + vec3(4.2, 9.6, iTime * uWobTimeHi)) - 0.5)
                   * (uWobBaseHi + bandSel(uWobHiSrc) * uWobHi);
  float detail   = (fbm(p * uDetFreq + vec3(17.1, iTime * uDetTime, 5.3)) - 0.5)
                   * uDet * bandSel(uDetSrc);
  return d + dispLow + dispHigh + detail;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.01, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
  vec3 ro = vec3(0.0, 0.0, -uCamDist);
  vec3 rd = normalize(vec3(uv - uCenter, uCamFov));
  vec3 C = uAlbumColor;
  vec3 col = C * (uAmbient + bandSel(uAmbientSrc) * 0.1);
  float t = 0.0, glow = 0.0;
  bool hit = false;

  for (int i = 0; i < 200; i++) {
    if (i >= uMaxSteps) break;
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < uHitEps) { hit = true; break; }
    if (t > uMaxDist) break;
    glow += exp(-max(d, 0.0) * 5.0) * uGlowAcc;
    t += d;
  }

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    float diff = uDiffBase + (uDiffAmt + bandSel(uDiffSrc) * 0.3)
                 * max(dot(n, normalize(vec3(uLightX, uLightY, uLightZ))), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), uRimPow)
                * (uRimStr + bandSel(uRimSrc) * 0.5);
    col = C * diff + rim * (C + vec3(0.3)) + C * uFlash * bandSel(uFlashSrc);
  }

  col += C * glow * (uGlowBase + bandSel(uGlowSrc) * uGlowAmt);
  col = clamp(col, 0.0, 1.0);
  col = (col - 0.5) * (uContrast + bandSel(uContrastSrc) * 0.5) + 0.5;
  col = clamp(col, 0.0, 1.0);
  col = 1.0 - exp(-col * (uExposure + bandSel(uExposureSrc) * 0.5));

  float sh = pow(smoothstep(uShimLo, uShimHi, fbm(vec3(uv * 1.5 + iTime * 0.05, iTime * 0.10))), uShimPow)
             * (uShimBase + bandSel(uShimSrc) * uShimLvl + uBass * uShimBass);
  col += col * sh + C * sh * uShimColor;
  col = clamp(col, 0.0, 1.0);

  float scan = 0.95 + (uScanAmt + bandSel(uScanSrc) * 0.1) * sin(gl_FragCoord.y * uScanFreq + iTime * uScanTime);
  float vig = 1.0 - (uVigAmt + bandSel(uVigSrc) * 0.2) * dot(uv, uv * vec2(uVigX, uVigY));
  float grain = (hash(vec3(gl_FragCoord.xy, iTime)) - 0.5) * (uGrainAmt + bandSel(uGrainSrc) * 0.05);
  col = col * scan * vig + grain;

  // Transparent background: full alpha on hit, partial alpha for glow
  float alpha = hit ? 1.0 : clamp(glow * (0.6 + bandSel(uGlowSrc) * uGlowAmt) * 3.0, 0.0, 1.0);
  fragColor = vec4(clamp(col, 0.0, 1.0), alpha);
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

  // "my best settings v2" — hardcoded production values. Static uniforms set
  // once at program build; only bands/time/res/color/camFov are per-frame.
  STATIC_UNIFORMS: {
    uRadAmt: 0.25, uRadBase: 0.5, uRadSrc: 1, uRadLvl: 0.055, uRadLvlSrc: 2,
    uWobLo: 0.64, uWobLoSrc: 2, uWobBaseLo: 0.014, uWobFreqLo: 1.2, uWobTimeLo: 0.08,
    uWobHi: 0.36, uWobHiSrc: 5, uWobBaseHi: 0.038, uWobFreqHi: 2.1, uWobTimeHi: 0.12,
    uDet: 0.34, uDetSrc: 4, uDetFreq: 4.1, uDetTime: 0.7,
    uCamDist: 3.8, uMaxDist: 5.5, uHitEps: 0.0025, uGlowAcc: 0.014, uGlowBase: 0.65,
    uAmbient: 0.125, uAmbientSrc: 1, uDiffBase: 0.0, uDiffAmt: 0.0, uDiffSrc: 0,
    uLightX: 0.2, uLightY: 0.65, uLightZ: -0.3,
    uRimPow: 4.0, uRimStr: 1.04, uRimSrc: 4,
    uGlowAmt: 0.9, uGlowSrc: 5, uFlash: 0.24, uFlashSrc: 1,
    uShimLvl: 0.27, uShimSrc: 1, uShimBase: 0.095, uShimBass: 0.14, uShimColor: 0.3,
    uShimPow: 2.5, uShimLo: 0.3, uShimHi: 0.64,
    uContrast: 1.3, uContrastSrc: 0, uExposure: 1.2, uExposureSrc: 0,
    uScanAmt: 0.0, uScanSrc: 0, uScanFreq: 2.0, uScanTime: 8.0,
    uVigAmt: 0.0, uVigSrc: 0, uVigX: 3.0, uVigY: 1.8,
    uGrainAmt: 0.062, uGrainSrc: 0,
    uMaxSteps: 148
  },

  // All uniform names (static + dynamic) for location lookup.
  UNIFORM_NAMES: [
    'iTime', 'iResolution',
    'uBass', 'uMidLow', 'uMidHigh', 'uTreble', 'uLevel',
    'uAlbumColor', 'uCenter', 'uCamFov',
    'uRadAmt', 'uRadBase', 'uRadSrc', 'uRadLvl', 'uRadLvlSrc',
    'uWobLo', 'uWobLoSrc', 'uWobBaseLo', 'uWobFreqLo', 'uWobTimeLo',
    'uWobHi', 'uWobHiSrc', 'uWobBaseHi', 'uWobFreqHi', 'uWobTimeHi',
    'uDet', 'uDetSrc', 'uDetFreq', 'uDetTime',
    'uCamDist', 'uMaxDist', 'uHitEps', 'uGlowAcc', 'uGlowBase',
    'uAmbient', 'uAmbientSrc', 'uDiffBase', 'uDiffAmt', 'uDiffSrc',
    'uLightX', 'uLightY', 'uLightZ',
    'uRimPow', 'uRimStr', 'uRimSrc',
    'uGlowAmt', 'uGlowSrc', 'uFlash', 'uFlashSrc',
    'uShimLvl', 'uShimSrc', 'uShimBase', 'uShimBass', 'uShimColor', 'uShimPow', 'uShimLo', 'uShimHi',
    'uContrast', 'uContrastSrc', 'uExposure', 'uExposureSrc',
    'uScanAmt', 'uScanSrc', 'uScanFreq', 'uScanTime',
    'uVigAmt', 'uVigSrc', 'uVigX', 'uVigY',
    'uGrainAmt', 'uGrainSrc',
    'uMaxSteps'
  ],

  state: 0,         // default ON (viz); -1 = off, >=0 = shader index
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
      const raw = localStorage.getItem('musicapp:viz');
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.which === 'number' && p.which >= -1 && p.which < this.SHADERS.length) this.state = p.which;
      } else {
        this._needsServerDefault = true;
      }
    } catch (e) {}
    if (this.btn) this.btn.addEventListener('click', () => this.cycle());
    const disc = document.querySelector('.np-artwork');
    if (disc) disc.addEventListener('click', (e) => {
      if (e.target.closest('.np-float-tray') || e.target.closest('.np-review-overlay')) return;
      this.cycle();
    });
    this._applyVisualState();
    // Invalidate the cached disc-center on resize/scroll (getBoundingClientRect
    // is expensive and was called every frame, forcing layout reflow at 30fps).
    window.addEventListener('resize', () => this._invalidateCenter());
    window.addEventListener('scroll', () => this._invalidateCenter(), true);
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

  // Called by App.init() after Store has loaded public settings. If the user
  // has no localStorage preference yet, apply the admin-configured default.
  applyServerDefault() {
    if (!this._needsServerDefault) return;
    this._needsServerDefault = false;
    const def = Store.defaultNowPlayingView;
    if (def === 'album_art') this.state = -1;
    this._applyVisualState();
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
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: false });
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
      const entry = { prog, loc: { aPos: gl.getAttribLocation(prog, 'aPos') } };
      for (const n of this.UNIFORM_NAMES) entry.loc[n] = gl.getUniformLocation(prog, n);
      // Static uniforms are set once here (program must be active to set them).
      gl.useProgram(prog);
      this._setStaticUniforms(gl, entry);
      return entry;
    });
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this._vbuf = buf;
    return true;
  },

  // Apply STATIC_UNIFORMS once per program. uMaxSteps is the only int; rest are float.
  _setStaticUniforms(gl, p) {
    const s = this.STATIC_UNIFORMS;
    for (const name in s) {
      const loc = p.loc[name];
      if (loc == null) continue;
      if (name === 'uMaxSteps') gl.uniform1i(loc, s[name]);
      else gl.uniform1f(loc, s[name]);
    }
  },

  _ensureAudio() {
    if (this._audioReady) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const actx = new Ctx();
      const src = actx.createMediaElementSource(Player.audio);
      const an = actx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.4;
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
    // ---- tunables (test-bench) ----
    const BYPASS    = false;  // skip dynamics, return raw v
    const DECAY     = 3;      // RANGE_DECAY: vMax/vMin trailing time constant (s)
    const RANGE_LO  = 0.03;   // GUARD_LO: range-guard smoothstep lower bound
    const RANGE_HI  = 0.12;   // GUARD_HI: range-guard smoothstep upper bound
    const FLOOR_RNG = 0.03;   // min range in normalizer (avoids divide-by-noise)
    const GAMMA     = 1.4;    // shaping exponent on normalized value (n^GAMMA)
    const STRENGTH  = 0.45;   // confidence blend weight toward stretched signal
    const ATK = [0.6, 0.37, 0.65, 0.4];    // per-band attack  (bass, midLow, midHigh, treble)
    const REL = [0.395, 0.245, 0.17, 0.355]; // per-band release
    // --------------------------------
    if (BYPASS) return v;
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
    const bi = slot % 4;
    const rel = REL[bi];
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
    const atk = ATK[bi];
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
    // Canvas is position:fixed fullscreen → clientWidth/Height = viewport.
    // Non-square (fills the screen), higher scale than the old disc-constrained
    // square crop. maxEdge caps 4K/high-DPI so the 148-step raymarch stays affordable.
    const mobile = (window.innerWidth || 9999) <= 768;
    const scale = mobile ? 0.6 : 0.85;
    const d = Math.min(window.devicePixelRatio || 1, 2.0) * scale;
    let w = Math.round((this.canvas.clientWidth || 300) * d);
    let h = Math.round((this.canvas.clientHeight || 300) * d);
    const maxEdge = 1920;
    const long = Math.max(w, h);
    if (long > maxEdge) { const k = maxEdge / long; w = Math.round(w * k); h = Math.round(h * k); }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  },

  _loop() {
    // Scheduler: always re-arms the next frame even if _frame throws, so a
    // transient first-open error can't permanently kill the render loop
    // (which left a blank canvas until the user toggled off→on).
    // Throttled to 30fps: the raymarcher is expensive and 60fps saturates the
    // main thread, starving the <audio> element's timeupdate events and causing
    // playback stutter/speed drift. 30fps keeps audio scheduling smooth.
    const now = performance.now();
    if (this._lastFrameT && now - this._lastFrameT < 33) {
      this._raf = requestAnimationFrame(() => this._loop());
      return;
    }
    this._lastFrameT = now;
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
    if (this._analyser) {
      this._analyser.getByteFrequencyData(this._freq);
      for (let i = 0; i < 13; i++) b += this._freq[i];
      for (let i = 13; i < 40; i++) ml += this._freq[i];
      for (let i = 40; i < 73; i++) mh += this._freq[i];
      for (let i = 73; i < 184; i++) tr += this._freq[i];
      b /= 13 * 255; ml /= 27 * 255; mh /= 33 * 255; tr /= 111 * 255;
      b = Math.max(0, Math.min(1, b * 1.0 - 0.01)); ml = Math.max(0, Math.min(1, ml * 0.9 - 0.01)); mh = Math.max(0, Math.min(1, mh * 0.9 - 0.01)); tr = Math.max(0, Math.min(1, tr * 1.4 - 0.01));
      b = this._bandDyn(0, b, dt); ml = this._bandDyn(1, ml, dt); mh = this._bandDyn(2, mh, dt); tr = this._bandDyn(3, tr, dt);
    }
    const follow = (cur, prev, atk, rel) => {
      if (cur > prev) return prev + (cur - prev) * atk;
      const dynRel = Math.min(1, rel * (1 + prev * 1.4));
      return prev + (cur - prev) * dynRel;
    };
    this._bands.bass = follow(b, this._bands.bass, 0.67, 0.205);
    this._bands.midLow = follow(ml, this._bands.midLow, 0.42, 0.09);
    this._bands.midHigh = follow(mh, this._bands.midHigh, 0.02, 0.22);
    this._bands.treble = follow(tr, this._bands.treble, 0.39, 0.3);
    const lvl = (this._bands.bass + this._bands.midLow + this._bands.midHigh + this._bands.treble) / 4;
    this._bands.level = follow(lvl, this._bands.level, 0.55, 0.16);

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
      // Portrait: canvas is now truly fullscreen (tall). The shader sizes the
      // sphere to canvas height, so zoom out (lower uCamFov) proportional to
      // aspect so the sphere fits the narrow width instead of clipping.
      const _asp = (window.innerWidth || 1) / (window.innerHeight || 1);
      gl.uniform1f(p.loc.uCamFov, _asp >= 1 ? 1.3 : 1.75 * _asp);
      // Shift the sphere so it sits where the album disc was (artwork region
      // center), not viewport center. Canvas is fullscreen → rect = viewport.
      const _c = this._computeCenter();
      gl.uniform2f(p.loc.uCenter, _c[0], _c[1]);
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
  // Disc (.np-art-wrapper) center in shader-uv units relative to the canvas.
  // Shader gl_FragCoord is bottom-up, CSS rects are top-down → flip y.
  // Lets the fullscreen sphere render where the album disc sits instead of at
  // viewport center (which is below the disc, since controls take bottom space).
  // Cached + invalidated on resize/scroll to avoid forced layout reflow at 30fps.
  _computeCenter() {
    if (this._centerCache != null) return this._centerCache;
    const disc = document.querySelector('.np-art-wrapper');
    const cr = this.canvas.getBoundingClientRect();
    if (!disc || !cr || cr.height < 2) return [0, 0];
    const dr = disc.getBoundingClientRect();
    const cx = (dr.left + dr.width / 2) - cr.left;
    const cy = (dr.top + dr.height / 2) - cr.top;
    const H = cr.height;
    this._centerCache = [(cx - cr.width / 2) / H, (H / 2 - cy) / H];
    return this._centerCache;
  },

  _invalidateCenter() { this._centerCache = null; },

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
