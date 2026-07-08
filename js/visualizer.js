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

// Solid raymarched SDF sphere with fbm surface displacement — the "round 2"
// look. Depth comes from the shaded gradient; bass pumps the radius; mid
// ripples the displacement. Color is uAlbumColor, now fed by the working
// self-sampling pipeline (_sampleCoverColor), so it tracks the cover.
float map(vec3 p){
  float r = 1.0 + 1.3*uBass + 0.12*uLevel;
  float d = length(p) - r;
  // Calm when quiet: low idle displacement (~0.05) so the sphere settles smooth
  // when audio is low; mid ripples + bass bulge it when active. Slow time anim.
  float disp = (fbm(p*1.5 + vec3(0.0,0.0,iTime*0.15)) - 0.5) * (0.05 + uMid*0.9 + uBass*0.4);
  // Treble shimmer — subtle + slow so it doesn't jitter when quiet.
  float detail = (fbm(p*4.0 + vec3(0.0,iTime*0.8,0.0)) - 0.5) * 0.18 * uTreble;
  return d + disp + detail;
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
    // Matte: asymmetric directional key (lights the +x/+y side) + soft fill.
    // NO fresnel rim — that symmetric bright ring read as a mirror. Lit side
    // differs from shadow side, so left/right are no longer equal.
    float key = max(dot(n, normalize(vec3(0.6, 0.7, -0.8))), 0.0);
    float fill = 0.3*max(dot(n, normalize(vec3(-0.5, -0.3, 0.6))), 0.0);
    float diff = 0.4 + 0.55*key + fill;
    col = C*diff + C*0.18*uBass;  // kick bloom on the surface
  }
  col += C * glow * (0.7 + uLevel*2.0);   // version-1-level strong outer glow
  col = 1.0 - exp(-col*1.1);              // tone-map: glows but never blows to white
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
    if (on && np && !np.classList.contains('hidden')) this._start();
    else this._stop();
  },

  onShowNowPlaying() {
    if (this.state < 0) return;
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
      this.canvas.width = px;
      this.canvas.height = px;
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
    // Self-healing init every frame: GL + a compiled program for the current
    // shader. A transient failure on first open (canvas not laid out, GL not
    // ready) just skips this frame and retries next frame.
    if (!this._ensureGL() || !this._programs || !this._programs[this.state]) return;
    this._ensureAudio();
    if (this._actx && this._actx.state === 'suspended') this._actx.resume();
    if (this._t0 == null) this._t0 = performance.now() / 1000;

    const gl = this.gl;
    const wrap = this.canvas.parentElement;
    if (!wrap || wrap.clientWidth < 2) return;
    this._resize();

    let b = 0, m = 0, tr = 0;
    if (this._analyser) {
      this._analyser.getByteFrequencyData(this._freq);
      for (let i = 0; i < 8; i++) b += this._freq[i];
      for (let i = 8; i < 64; i++) m += this._freq[i];
      for (let i = 64; i < 200; i++) tr += this._freq[i];
      b /= 8 * 255; m /= 56 * 255; tr /= 136 * 255;
      b = Math.min(1, b * 3.0); m = Math.min(1, m * 1.6); tr = Math.min(1, tr * 1.8);
    }
    // asymmetric: fast attack (punch on the beat), slower release (shape holds)
    const follow = (cur, prev, atk, rel) => cur > prev ? prev + (cur - prev) * atk : prev + (cur - prev) * rel;
    this._bands.bass = follow(b, this._bands.bass, 0.9, 0.12);
    this._bands.mid = follow(m, this._bands.mid, 0.5, 0.22);
    this._bands.treble = follow(tr, this._bands.treble, 0.65, 0.28);
    const lvl = (this._bands.bass + this._bands.mid + this._bands.treble) / 3;
    this._bands.level = follow(lvl, this._bands.level, 0.5, 0.2);

    // Live color: sample the cover dominant color (same-origin #np-art),
    // re-deriving only when it changes. Eased toward the target each frame so
    // song-to-song changes crossfade smoothly instead of snapping.
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
