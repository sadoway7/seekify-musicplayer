# Visualizer map

How `js/visualizer.js` turns audio into pictures. Written for someone who will
not read the GLSL. All line numbers refer to `js/visualizer.js`.

## 1. Signal flow

```
<audio> element (Player.audio)
   │  createMediaElementSource  (only when full viz is ON — state >= 0)
   ▼
AnalyserNode  (fftSize=1024, 512 bins, smoothing=0.5, dB range −100..−30)
   │  getByteFrequencyData(this._freq)        [Uint8Array(512), 0..255]
   ▼
_preprocessFreq()   ← NEW. Per-bin: silence gate → 2s moving-average deviation
   │                 → gamma expand → fast-attack/slow-release → write 0..255
   │                 back into this._freq IN PLACE. Runs every frame.
   ▼
this._freq  (still Uint8Array(512), still 0..255 — same shape downstream always saw)
   │
   ├──► FULL-VIZ path (state >= 0): 4 band sums → /255 → boost+clamp → follow() → uniforms
   └──► MINI-VIZ path (state < 0):  4 band sums → /255 → pow(,0.65) → adaptive floor
                                      → mf() smoothing → uniforms
   ▼
GLSL uniforms:  uBass  uMidLow  uMidHigh  uTreble  uLevel  uAlbumColor  iTime
   ▼
drawArrays (one full-screen triangle) → canvas
```

One `requestAnimationFrame` loop (`_loop` → `_frame`). Both visual modes share
the single analyser read and the single `_preprocessFreq` call.

## 2. Band table

Bin width ≈ 43 Hz at 44.1 kHz (≈ 47 Hz at 48 kHz). Hz ranges are approximate.

### Full viz (the "spheres" shader, state = 0)

| Band    | Bins     | ~Hz        | Boost & clamp (pre-follow)        | Attack / Release | Drives (shader)                          |
|---------|----------|------------|-----------------------------------|------------------|------------------------------------------|
| bass    | 0–11     | 0–474      | `v*2.5 − 0.01`, clamp 0..1        | 0.90 / 0.18      | Sphere radius pulse + brightness punch   |
| midLow  | 12–39    | 517–1680   | `v*1.4 − 0.01`, clamp 0..1        | 0.50 / 0.30      | Low-frequency surface displacement       |
| midHigh | 40–71    | 1723–3058  | `v*1.2 − 0.01`, clamp 0..1        | 0.55 / 0.22      | High-frequency surface displacement      |
| treble  | 72–199   | 3101–8571  | `v*2.2 − 0.01`, clamp 0..1        | 0.78 / 0.30      | Fine surface detail / texture            |
| level   | (avg of the 4) | —     | none                              | 0.50 / 0.20      | Glow intensity + global radius scale     |

`follow(cur,prev,atk,rel)` is asymmetric: instant-ish attack, plus a dynamic
release that decays faster when the previous value is already high.

### Mini viz (decorative, state < 0)

Extra stage before smoothing: an adaptive noise floor
(`floor = floor*0.96 + raw*0.04`, then `raw − floor*0.75`) and a `pow(.,0.65)`
gamma, both per band.

| Band    | Bins       | ~Hz         | Boost & clamp                              | Attack / Release | Drives (mini shader)            |
|---------|------------|-------------|--------------------------------------------|------------------|---------------------------------|
| bass    | 2–5        | 86–215      | `pow(min(1, v/(4*255)*1.2), 0.65)`         | 0.70 / 0.12      | Disk radius                     |
| midLow  | 6–34       | 258–1464    | `pow(min(1, v/(29*255)*1.0), 0.65)`        | 0.50 / 0.15      | Edge tint brightness            |
| midHigh | 35–92      | 1507–3963   | `pow(min(1, v/(58*255)*1.0), 0.65)`        | 0.55 / 0.17      | (computed; not consumed by mini shader) |
| treble  | 93–231     | 4005–9949   | `pow(min(1, v/(139*255)*1.5), 0.65)`       | 0.70 / 0.19      | Edge tint brightness            |
| level   | (avg of the 4) | —        | none                                       | 0.50 / 0.12      | Halo size + brightness          |

`uAlbumColor` is fixed gray (0.8,0.8,0.8) in mini mode; in full viz it is the
vividified dominant color of the current album cover.

## 3. Render states (`this.state`)

| Value | Meaning                                                                 |
|-------|-------------------------------------------------------------------------|
| `-1`  | Full viz OFF. Mini-viz canvas runs if present (decorative, flat). The `<audio>` element is NOT routed through Web Audio, so background/lock-screen playback is unaffected on iOS/Android. |
| `0`   | Full viz ON: the `spheres` shader. Audio is routed `src → analyser → destination`. |

Toggle (`toggle()`, line 155) flips between `-1` and `0`. `setShader(which)`
(line 128) accepts any index `< SHADERS.length`; today only index `0`
(`spheres`) is defined, so the array is ready for more modes but ships one.

Note: the analyser is created lazily the first time full viz turns on, and it
persists afterwards. So the mini-viz stays flat (no data) until the user has
turned the full viz on at least once; after that the mini-viz shows live data
even when toggled back off.

## 4. Tunable surface (everything that changes the picture)

### A. Pre-processing constants — top of `_preprocessFreq()` (lines 254–262)

| Const     | Default | Plain language                                                                                       |
|-----------|---------|------------------------------------------------------------------------------------------------------|
| `SILENCE` | 4       | Raw byte below this → that bin is forced dark (output 0); the moving average still tracks. Keeps pauses/endings black. |
| `TAU`     | 2.0 s   | How slowly each bin's moving average tracks the signal. Larger = slower baseline = more deviation passes through = more motion. |
| `DEADZONE`| 0.03    | Normalized deviation below this → target 0. Gate for noise-level flicker; quiet content under this contributes nothing. Gamma is steep near zero, so the margin matters. |
| `GAMMA`   | 1.8     | Expansion exponent on the deviation. Higher widens small deviations (more motion out of loud/clipped tracks). Implemented as `pow(dev, 1/γ)`. |
| `GAIN`    | 1.4     | Linear multiplier on the expanded deviation (the "accent" layer).                                    |
| `FLOOR`   | 0.35    | Blend weight of raw level: `blend = FLOOR·(raw/255) + (1−FLOOR)·target`. Keeps loud sustained content lit (the lava-lamp base). The whole blend is then run through ATTACK/RELEASE, so raw FFT jitter on the FLOOR term is smoothed too. |
| `ATTACK`  | 0.4     | Per-frame coefficient when the blend is rising. High = transients snap up fast.                      |
| `RELEASE` | 0.08    | Per-frame coefficient when the blend is falling. Low = peaks hang/decay slowly for a visible tail.   |

### B. Per-band boosts + envelopes

Full viz boosts (line 375): bass `*2.5`, midLow `*1.4`, midHigh `*1.2`,
treble `*2.2`, all `− 0.01` then clamp 0..1.
Full viz `follow` attack/release (lines 382–388): bass 0.9/0.18, midLow
0.5/0.30, midHigh 0.55/0.22, treble 0.78/0.30, level 0.5/0.20.

Mini viz boosts (lines 428–431): bass `*1.2`, midLow `*1.0`, midHigh `*1.0`,
treble `*1.5`, each inside `pow(min(1, v/(N*255)), 0.65)`.
Mini viz `mf` attack/release (lines 438–444): bass 0.7/0.12, midLow 0.5/0.15,
midHigh 0.55/0.17, treble 0.7/0.19, level 0.5/0.12.
Mini viz adaptive floor (`af`): **now a pass-through** — `af = (raw, key) => raw`.
It was a second deviation centerer built for raw pegged-FFT input that no longer
exists (preprocess already centers the signal), so it double-subtracted
already-centered data. Mini now consumes the preprocessed signal directly, like
the full viz. The `_miniFloor` state is left in place but unused.

### C. Analyser settings (do not change without reason)

`fftSize = 1024` (line 236), `smoothingTimeConstant = 0.5` (line 237),
`minDecibels = −100`, `maxDecibels = −30` (Web Audio defaults, not explicitly
set). Changing `fftSize` changes bin count and every band range above.
