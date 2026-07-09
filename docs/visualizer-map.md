# Visualizer map

How `js/visualizer.js` turns audio into pictures. Written for someone who will
not read the GLSL. All line numbers refer to `js/visualizer.js`.

## 1. Signal flow

```
<audio> element (Player.audio)
   │  createMediaElementSource  (only when full viz is ON — state >= 0)
   ▼
AnalyserNode  (fftSize=1024, 512 bins, smoothing=0.5, dB range −100..−30)
   │  getByteFrequencyData(this._freq)   [Uint8Array(512), 0..255] — RAW bytes,
   │                                      no per-bin processing anymore.
   ▼
this._freq  (raw analyser data)
   │
   ├──► FULL-VIZ path (state >= 0): 4 band sums → /255 → boost+clamp
   │        → _bandDyn(slots 0-3) → follow() → uniforms
   └──► MINI-VIZ path (state < 0):  4 band sums → /255 → pow(,0.65)
            → _bandDyn(slots 4-7) → mf() smoothing → uniforms
   ▼
GLSL uniforms:  uBass  uMidLow  uMidHigh  uTreble  uLevel  uAlbumColor  iTime
   ▼
drawArrays (one full-screen triangle) → canvas
```

One `requestAnimationFrame` loop (`_loop` → `_frame`). Both visual modes share
the single analyser read. Audio-reactive dynamics live at the band level in
`_bandDyn` (applied after boost, before the envelopes) — it replaced the old
per-bin `_preprocessFreq`, which amplified raw FFT bin noise.

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

The mini bands get the same `pow(.,0.65)` gamma boost shown below, then run
through `_bandDyn` (slots 4-7) just like the full viz — there is no longer a
separate mini adaptive floor (`af` was removed; `_bandDyn` now centers both paths).

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

### A. Band-dynamics constants — top of `_bandDyn()`

`_bandDyn(slot, v, dt)` runs per band after the boost/clamp, before the
envelopes. 8 slots: 0-3 full viz (b,ml,mh,tr), 4-7 mini (mb,mml,mmh,mtr). It
auto-range-normalizes each band against a trailing vMin/vMax and gates expansion
by a confidence measure so flat/noisy content falls back to the raw band value.

| Const       | Default | Plain language                                                                                       |
|-------------|---------|------------------------------------------------------------------------------------------------------|
| `DECAY`     | 4.0 s   | Time constant for the trailing vMax (slow decay) and vMin (slow rise). Sets how fast the band's recent range adapts. |
| `RANGE_LO`  | 0.04    | smoothstep lower bound on the confidence input (range). Below this range → zero confidence → raw passthrough (no expansion of noise). |
| `RANGE_HI`  | 0.12    | smoothstep upper bound. At/above this range → full confidence → fully stretched signal.              |
| `FLOOR_RNG` | 0.04    | Minimum range used in the normalizer denominator; prevents divide-by-noise on near-flat content.      |
| `GAMMA`     | 1.4     | Shaping exponent on the normalized value (`n^GAMMA`): squashes the floor, preserves peaks → punchier pulses. |
| `STRENGTH`  | 0.8     | Blend weight toward the stretched signal: `out = mix(v, n, conf*STRENGTH)`.                          |
| `ATK_LOW` / `REL_LOW`  | 0.25 / 0.06 | Bass slots (0, 4) smoothing: punchy attack, slow release.                                    |
| `ATK_MID` / `REL_MID`  | 0.5 / 0.10  | Other slots smoothing.                                                                        |

Edge cases: silence (`v < 0.01`) outputs 0 while vMax still decays; on the first
frame after a seek all 8 slots reset to that frame's values (no flare). First
frame ever also seeds vMin/vMax/sm to v.

### B. Per-band boosts + envelopes

Full viz boosts (in `_frame`, band-sum loop): bass `*2.5`, midLow `*1.4`,
midHigh `*1.2`, treble `*2.2`, all `− 0.01` then clamp 0..1 — then each passes
through `_bandDyn` (slots 0-3) before `follow`.
Full viz `follow` attack/release: bass 0.9/0.18, midLow 0.5/0.30,
midHigh 0.55/0.22, treble 0.78/0.30, level 0.5/0.20.

Mini viz boosts: bass `*1.2`, midLow `*1.0`, midHigh `*1.0`, treble `*1.5`,
each inside `pow(min(1, v/(N*255)), 0.65)` — then each passes through `_bandDyn`
(slots 4-7) before `mf`.
Mini viz `mf` attack/release: bass 0.7/0.12, midLow 0.5/0.15,
midHigh 0.55/0.17, treble 0.7/0.19, level 0.5/0.12.

The old mini adaptive floor (`af`) is removed entirely — `_bandDyn` now handles
both paths. `_miniFloor` is left declared but unused.

### C. Analyser settings (do not change without reason)

`fftSize = 1024` (line 236), `smoothingTimeConstant = 0.5` (line 237),
`minDecibels = −100`, `maxDecibels = −30` (Web Audio defaults, not explicitly
set). Changing `fftSize` changes bin count and every band range above.
