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
uniform float uBass, uMid, uTreble, uLevel;
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

float map(vec3 p){
  float r = 1.0 + 0.9*uBass + 0.1*uLevel;
  float d = length(p) - r;
  float disp = (fbm(p*1.5 + vec3(0.0, 0.0, iTime*0.3)) - 0.5) * (0.18 + uMid*0.8 + uBass*0.35);
  return d + disp;
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
    glow += exp(-max(d, 0.0)*4.0) * 0.018;
    t += d;
  }
  if (hit) {
    vec3 p = ro + rd*t;
    vec3 n = calcNormal(p);
    // Soft wrap lighting (key + fill, high ambient) — smooth and self-luminous.
    // No silhouette rim: the old fresnel term read as a "mirror" edge.
    float key = max(dot(n, normalize(vec3(0.55, 0.7, -0.8))), 0.0);
    float fill = max(dot(n, normalize(vec3(-0.5, -0.25, 0.45))), 0.0);
    float diff = 0.45 + 0.4*key + 0.15*fill;
    col = C*diff;
  }
  col += C * glow * (0.55 + uLevel*0.9);
  col = clamp(col, 0.0, 1.0);
  fragColor = vec4(col, 1.0);
}`
    }
  ],

  VERT: `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`,

  state: -1,        // -1 = off, >=0 = shader index
  gl: null,
  _audioReady: false,
  _bands: { bass: 0, mid: 0, treble: 0, level: 0 },
  _color: null,

  init() {
    this.canvas = document.getElementById('np-viz-canvas');
    this.btn = document.querySelector('.np-viz-btn');
    if (!this.canvas || !this.btn) return;
    try {
      const p = JSON.parse(localStorage.getItem('musicapp:viz') || '{}');
      if (typeof p.which === 'number' && p.which >= 0 && p.which < this.SHADERS.length) this.state = p.which;
    } catch (e) {}
    this.btn.addEventListener('click', () => this.cycle());
    this._applyVisualState();
  },

  cycle() {
    // off → 0 → off (one shader). Iterating SHADERS.length turns this into off→0..N→off.
    this.state = (this.state < 0) ? 0 : -1;
    this._persist();
    this._applyVisualState();
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
    if (on && np && !np.classList.contains('hidden')) this._startWhenReady();
    else this._stop();
  },

  onShowNowPlaying() {
    if (this.state < 0) return;
    this._startWhenReady();
  },

  // Wait for the canvas to have a real layout size before starting GL. On the
  // first open after an app reload, now-playing was just un-hidden and the
  // canvas can read clientWidth=0 for several frames; starting GL then gave a
  // blank render that only recovered after an off→on toggle.
  _startWhenReady(tries) {
    if (tries == null) tries = 0;
    if (this.state < 0) return;
    const wrap = this.canvas && this.canvas.parentElement;
    if (!wrap || wrap.clientWidth < 2) {
      if (tries < 30) requestAnimationFrame(() => this._startWhenReady(tries + 1));
      return;
    }
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
          uMid: gl.getUniformLocation(prog, 'uMid'),
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
      an.smoothingTimeConstant = 0.3;
      src.connect(an);
      an.connect(actx.destination);
      this._actx = actx;
      this._analyser = an;
      this._freq = new Uint8Array(an.frequencyBinCount);
      this._wave = new Uint8Array(an.fftSize);
      this._audioReady = true;
    } catch (e) { console.warn('[viz] audio init failed:', e); }
  },

  _start() {
    if (!this._ensureGL()) return;
    if (!this._programs || !this._programs[this.state]) return;
    this._ensureAudio();
    if (this._actx && this._actx.state === 'suspended') this._actx.resume();
    this._t0 = performance.now() / 1000;
    this._resize();
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
      this.canvas.width = px;
      this.canvas.height = px;
      this.gl.viewport(0, 0, px, px);
    }
  },

  _loop() {
    const gl = this.gl;
    const wrap = this.canvas.parentElement;
    if (!wrap || wrap.clientWidth < 2) { this._raf = requestAnimationFrame(() => this._loop()); return; }
    this._resize();

    let b = 0, m = 0, tr = 0;
    if (this._analyser) {
      this._analyser.getByteFrequencyData(this._freq);
      for (let i = 0; i < 8; i++) b += this._freq[i];
      for (let i = 8; i < 64; i++) m += this._freq[i];
      for (let i = 64; i < 200; i++) tr += this._freq[i];
      b /= 8 * 255; m /= 56 * 255; tr /= 136 * 255;
      b = Math.min(1, b * 2.5); m = Math.min(1, m * 1.4); tr = Math.min(1, tr * 1.5);
    }
    // asymmetric: fast attack (punch on the beat), slower release (shape holds)
    const follow = (cur, prev, atk, rel) => cur > prev ? prev + (cur - prev) * atk : prev + (cur - prev) * rel;
    this._bands.bass = follow(b, this._bands.bass, 0.85, 0.15);
    this._bands.mid = follow(m, this._bands.mid, 0.45, 0.25);
    this._bands.treble = follow(tr, this._bands.treble, 0.6, 0.3);
    const lvl = (this._bands.bass + this._bands.mid + this._bands.treble) / 3;
    this._bands.level = follow(lvl, this._bands.level, 0.5, 0.2);

    let cr = 0.83, cg = 0.94, cb = 0.25;
    if (this._color) { cr = this._color[0]; cg = this._color[1]; cb = this._color[2]; }

    const p = this._programs[this.state];
    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbuf);
    gl.enableVertexAttribArray(p.loc.aPos);
    gl.vertexAttribPointer(p.loc.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(p.loc.iTime, (performance.now() / 1000) - this._t0);
    gl.uniform2f(p.loc.iResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(p.loc.uBass, this._bands.bass);
    gl.uniform1f(p.loc.uMid, this._bands.mid);
    gl.uniform1f(p.loc.uTreble, this._bands.treble);
    gl.uniform1f(p.loc.uLevel, this._bands.level);
    gl.uniform3f(p.loc.uAlbumColor, cr, cg, cb);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this._raf = requestAnimationFrame(() => this._loop());
  },

  // Called by UI._applyNowPlayingBg when a cover's dominant color is computed
  // (push, not poll) — fires on every album change so the viz retints immediately.
  // r,g,b in 0..1. Apply the SAME vivid transform as the scrubber/waveform
  // (vibS = s+35, vibL = clamp(l+10,45,65)) so the viz matches the rest of
  // now-playing instead of showing the raw (often dark/muted) cover color.
  setColor(r, g, b) {
    const [h, s, l] = this._rgbToHsl(r, g, b);
    const vibS = Math.min(100, s + 35);
    const vibL = Math.min(65, Math.max(45, l + 10));
    this._color = this._hslToRgb(h, vibS, vibL);
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
