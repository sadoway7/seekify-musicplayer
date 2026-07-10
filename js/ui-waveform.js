// ============================================
// ui-waveform.js — Waveform rendering methods
// Extracted from ui.js. Loaded AFTER ui.js.
// All methods are assigned to the existing UI object.
// ============================================
Object.assign(UI, {

  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  },

  _colorAlpha(color, alpha) {
    if (color.startsWith('rgba')) {
      return color.replace(/,\s*[\d.]+\)$/, ', ' + alpha + ')');
    }
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }
    if (color.startsWith('rgb(')) {
      return color.replace('rgb(', 'rgba(').replace(')', ', ' + alpha + ')');
    }
    return color;
  },

  _generateWaveformPreviewPeaks(numBars) {
    const peaks = [];
    for (let i = 0; i < numBars; i++) {
      const t = i / numBars;
      const base = 0.15 + 0.7 * Math.pow(Math.sin(t * Math.PI), 0.8);
      const noise = 0.15 * (Math.sin(i * 1.7 + 0.3) * 0.5 + 0.5) * Math.cos(i * 0.4 + 1.2);
      peaks.push(Math.max(0.08, Math.min(1, base + noise)));
    }
    return peaks;
  },

  _paintWaveformPreview() {
    const canvas = document.getElementById('waveform-preview-canvas');
    if (!canvas) return;
    const sel = document.getElementById('setting-waveform-style');
    const style = sel ? sel.value : Store.waveformStyle;

    const dpr = window.devicePixelRatio || 1;
    const container = canvas.parentElement;
    const w = container.clientWidth;
    const h = 64;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const numBars = Math.floor(w / 5);
    const rawPeaks = this._generateWaveformPreviewPeaks(numBars);
    const data = rawPeaks.map(v => Math.max(8, Math.round(v * 100)));

    this._paintWaveformOnCanvas(ctx, data, 3, 2, canvas.width, canvas.height, 0.6, style);
  },

  _paintWaveformOnCanvas(ctx, data, pw, pg, w, h, progressFraction, style) {
    const dpr = window.devicePixelRatio || 1;
    pw *= dpr;
    pg *= dpr;
    const totalWidth = data.length * (pw + pg);

    const styleComp = getComputedStyle(document.documentElement);
    const playedColor = styleComp.getPropertyValue('--waveform-played').trim() || '#D4F040';
    const unplayedColor = styleComp.getPropertyValue('--waveform-unplayed').trim() || 'rgba(255, 255, 255, 0.22)';

    const playingPoint = progressFraction * data.length;

    ctx.clearRect(0, 0, w, h);

    if (style === 'mirror') {
      this._paintWaveformMirror(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor);
    } else if (style === 'layered') {
      this._paintWaveformLayered(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor);
    } else if (style === 'layered-mirror') {
      this._paintWaveformLayeredMirror(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor);
    } else if (style === 'squiggle') {
      this._paintWaveformSquiggle(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor);
    } else {
      this._paintWaveformRounded(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor);
    }
  },

  _paintWaveformRounded(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor) {
    const totalWidth = data.length * (pw + pg);
    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      const barH = (val / 100) * h * 0.85;
      const x = (w - totalWidth) / 2 + i * (pw + pg);
      const y = (h - barH) / 2;

      ctx.fillStyle = i < playingPoint ? playedColor : unplayedColor;

      const radius = Math.min(pw / 2, barH / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + pw - radius, y);
      ctx.arcTo(x + pw, y, x + pw, y + radius, radius);
      ctx.lineTo(x + pw, y + barH - radius);
      ctx.arcTo(x + pw, y + barH, x + pw - radius, y + barH, radius);
      ctx.lineTo(x + radius, y + barH);
      ctx.arcTo(x, y + barH, x, y + barH - radius, radius);
      ctx.lineTo(x, y + radius);
      ctx.arcTo(x, y, x + radius, y, radius);
      ctx.closePath();
      ctx.fill();
    }
  },

  _paintWaveformMirror(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor) {
    const totalWidth = data.length * (pw + pg);
    const mid = h * 0.68;
    const gap = Math.max(1, h * 0.02);
    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      const topH = (val / 100) * mid * 0.92;
      const botH = (val / 100) * (h - mid) * 0.92;
      const x = (w - totalWidth) / 2 + i * (pw + pg);

      const topColor = i < playingPoint ? playedColor : unplayedColor;

      const rTop = Math.min(pw / 2, topH / 2);
      ctx.fillStyle = topColor;
      ctx.beginPath();
      ctx.moveTo(x + rTop, mid - gap - topH);
      ctx.lineTo(x + pw - rTop, mid - gap - topH);
      ctx.arcTo(x + pw, mid - gap - topH, x + pw, mid - gap - topH + rTop, rTop);
      ctx.lineTo(x + pw, mid - gap);
      ctx.lineTo(x, mid - gap);
      ctx.lineTo(x, mid - gap - topH + rTop);
      ctx.arcTo(x, mid - gap - topH, x + rTop, mid - gap - topH, rTop);
      ctx.closePath();
      ctx.fill();

      const rBot = Math.min(pw / 2, botH / 2);
      const botTop = mid + gap;
      const botBot = mid + gap + botH;
      const grad = ctx.createLinearGradient(0, botTop, 0, botBot);
      const botColorStart = i < playingPoint ? this._colorAlpha(playedColor, 0.5) : this._colorAlpha(unplayedColor, 0.2);
      const botColorEnd = i < playingPoint ? this._colorAlpha(playedColor, 0) : this._colorAlpha(unplayedColor, 0);
      grad.addColorStop(0, botColorStart);
      grad.addColorStop(1, botColorEnd);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, botTop);
      ctx.lineTo(x + pw, botTop);
      ctx.lineTo(x + pw, botBot - rBot);
      ctx.arcTo(x + pw, botBot, x + pw - rBot, botBot, rBot);
      ctx.lineTo(x + rBot, botBot);
      ctx.arcTo(x, botBot, x, botBot - rBot, rBot);
      ctx.lineTo(x, botTop);
      ctx.closePath();
      ctx.fill();
    }
  },

  _colorToRGBA(ctx, css, fallback) {
    ctx.fillStyle = '#000';
    ctx.fillStyle = css || fallback;
    let v = ctx.fillStyle;
    if (v[0] === '#') {
      if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
      return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
    }
    const m = v.match(/rgba?\(([^)]+)\)/);
    const p = m[1].split(',').map(s => parseFloat(s));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  },

  _paintWaveformLayered(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor) {
    const layers = 6;
    const opacityFalloff = 0.52;
    const heightGrowth = 0.08;
    const waveAmplitude = 0.15;
    const wavePhaseShift = 1.4;
    const waveCycles = 2.4;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');
    const unplayed = this._colorToRGBA(ctx, unplayedColor, 'rgba(255,255,255,0.5)');

    const mid = h / 2;
    const maxH = h / 2 - 2;
    const freq = (Math.PI * 2 * waveCycles) / w;
    const playX = (playingPoint / data.length) * w;
    const totalWidth = data.length * (pw + pg);
    const hShiftAmp = (pw + pg) * 0.6;
    const hWaveFreq = (Math.PI * 2 * 1.5) / w;

    ctx.clearRect(0, 0, w, h);

    for (let l = layers - 1; l >= 0; l--) {
      const la = Math.pow(opacityFalloff, l);
      const hsc = 1 + l * heightGrowth;
      const phase = l * wavePhaseShift;
      const lw = pw * (1 - l * 0.04);

      for (let i = 0; i < data.length; i++) {
        const baseX = (w - totalWidth) / 2 + i * (pw + pg);
        const xOff = l * hShiftAmp * (0.5 + 0.5 * Math.sin(baseX * hWaveFreq + l * 0.8));
        const x = baseX + xOff;
        const cx = x + lw / 2;
        const barVal = data[i] / 100;
        const waveMod = 1 + waveAmplitude * Math.sin(baseX * freq + phase);
        const barH = Math.max(1.5, barVal * maxH * hsc * waveMod);
        const x0 = x + (pw - lw) / 2;

        const isPlayed = cx <= playX;
        const c = isPlayed ? played : unplayed;
        const alpha = (c[3] * la).toFixed(3);
        const full = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
        const fade = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)';

        const grad = ctx.createLinearGradient(0, mid - barH, 0, mid + barH);
        grad.addColorStop(0, fade);
        grad.addColorStop(0.12, full);
        grad.addColorStop(0.88, full);
        grad.addColorStop(1, fade);
        ctx.fillStyle = grad;
        ctx.fillRect(x0, mid - barH, lw, barH * 2);
      }
    }

    ctx.fillStyle = 'rgba(' + played[0] + ',' + played[1] + ',' + played[2] + ',0.85)';
    ctx.fillRect(playX - 0.6, 0, 1.2, h);
  },

  _paintWaveformLayeredScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth) {
    const layers = 6;
    const opacityFalloff = 0.52;
    const heightGrowth = 0.08;
    const waveAmplitude = 0.15;
    const wavePhaseShift = 1.4;
    const waveCycles = 2.4;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');
    const unplayed = this._colorToRGBA(ctx, unplayedColor, 'rgba(255,255,255,0.5)');
    const hoverC = this._colorToRGBA(ctx, hoverPlayed, 'rgba(212,240,64,0.55)');

    const mid = h / 2;
    const maxH = (h / 2 - 2) * scale;
    const freq = (Math.PI * 2 * waveCycles) / w;
    const playX = (playingPoint / data.length) * w;

    const hov = hoverX >= 0;
    const hx = hov ? hoverX : -1;
    const hLo = hov ? Math.min(playX, hx) : 0;
    const hHi = hov ? Math.max(playX, hx) : -1;
    const inHover = (cx) => hov && cx >= hLo && cx <= hHi;

    const hShiftAmp = (pw + pg) * 0.6;
    const hWaveFreq = (Math.PI * 2 * 1.5) / w;

    ctx.clearRect(0, 0, w, h);

    for (let l = layers - 1; l >= 0; l--) {
      const la = Math.pow(opacityFalloff, l);
      const hsc = 1 + l * heightGrowth;
      const phase = l * wavePhaseShift;
      const lw = pw * (1 - l * 0.04);

      for (let i = 0; i < data.length; i++) {
        const baseX = (w - totalWidth) / 2 + i * (pw + pg);
        const xOff = l * hShiftAmp * (0.5 + 0.5 * Math.sin(baseX * hWaveFreq + l * 0.8));
        const x = baseX + xOff;
        const cx = x + lw / 2;
        const barVal = data[i] / 100;
        const waveMod = 1 + waveAmplitude * Math.sin(baseX * freq + phase);
        const barH = Math.max(1.5, barVal * maxH * hsc * waveMod);
        const x0 = x + (pw - lw) / 2;

        let c;
        if (inHover(cx)) {
          c = hoverC;
        } else if (cx <= playX) {
          c = played;
        } else {
          c = unplayed;
        }
        const alpha = (c[3] * la).toFixed(3);
        const full = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
        const fade = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)';

        const grad = ctx.createLinearGradient(0, mid - barH, 0, mid + barH);
        grad.addColorStop(0, fade);
        grad.addColorStop(0.12, full);
        grad.addColorStop(0.88, full);
        grad.addColorStop(1, fade);
        ctx.fillStyle = grad;
        ctx.fillRect(x0, mid - barH, lw, barH * 2);
      }
    }

    ctx.fillStyle = 'rgba(' + played[0] + ',' + played[1] + ',' + played[2] + ',0.85)';
    ctx.fillRect(playX - 0.6, 0, 1.2, h);
  },

  _paintWaveformLayeredMirror(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor) {
    const layers = 6;
    const opacityFalloff = 0.52;
    const heightGrowth = 0.08;
    const waveAmplitude = 0.15;
    const wavePhaseShift = 1.4;
    const waveCycles = 2.4;
    const mirrorSplit = 0.68;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');
    const unplayed = this._colorToRGBA(ctx, unplayedColor, 'rgba(255,255,255,0.5)');

    const split = h * mirrorSplit;
    const gap = Math.max(2, h * 0.03);
    const maxTopH = split - gap - 2;
    const maxBotH = (h - split - gap) * 0.9;
    const freq = (Math.PI * 2 * waveCycles) / w;
    const playX = (playingPoint / data.length) * w;
    const totalWidth = data.length * (pw + pg);
    const hShiftAmp = (pw + pg) * 0.6;
    const hWaveFreq = (Math.PI * 2 * 1.5) / w;
    const botStart = split + gap;

    ctx.clearRect(0, 0, w, h);

    for (let l = layers - 1; l >= 0; l--) {
      const la = Math.pow(opacityFalloff, l);
      const hsc = 1 + l * heightGrowth;
      const phase = l * wavePhaseShift;
      const lw = pw * (1 - l * 0.04);

      for (let i = 0; i < data.length; i++) {
        const baseX = (w - totalWidth) / 2 + i * (pw + pg);
        const xOff = l * hShiftAmp * (0.5 + 0.5 * Math.sin(baseX * hWaveFreq + l * 0.8));
        const x = baseX + xOff;
        const cx = x + lw / 2;
        const barVal = data[i] / 100;
        const waveMod = 1 + waveAmplitude * Math.sin(baseX * freq + phase);
        const topH = Math.max(1.5, barVal * maxTopH * hsc * waveMod);
        const x0 = x + (pw - lw) / 2;

        const isPlayed = cx <= playX;
        const c = isPlayed ? played : unplayed;
        const alpha = (c[3] * la).toFixed(3);
        const full = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
        const fade = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)';

        const topGrad = ctx.createLinearGradient(0, split - gap - topH, 0, split - gap);
        topGrad.addColorStop(0, fade);
        topGrad.addColorStop(0.12, full);
        topGrad.addColorStop(0.88, full);
        topGrad.addColorStop(1, full);
        ctx.fillStyle = topGrad;
        ctx.fillRect(x0, split - gap - topH, lw, topH);
      }
    }

    for (let i = 0; i < data.length; i++) {
      const x = (w - totalWidth) / 2 + i * (pw + pg);
      const cx = x + pw / 2;
      const barVal = data[i] / 100;
      const barH = Math.max(1, barVal * maxBotH);
      const isPlayed = cx <= playX;
      const c = isPlayed ? played : unplayed;
      const botGrad = ctx.createLinearGradient(0, botStart, 0, botStart + barH);
      botGrad.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] * 0.5).toFixed(3) + ')');
      botGrad.addColorStop(0.4, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] * 0.2).toFixed(3) + ')');
      botGrad.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
      ctx.fillStyle = botGrad;
      ctx.fillRect(x, botStart, pw, barH);
    }

    ctx.fillStyle = 'rgba(' + played[0] + ',' + played[1] + ',' + played[2] + ',0.85)';
    ctx.fillRect(playX - 0.6, 0, 1.2, h);
  },

  _paintWaveformLayeredMirrorScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth) {
    const layers = 6;
    const opacityFalloff = 0.52;
    const heightGrowth = 0.08;
    const waveAmplitude = 0.15;
    const wavePhaseShift = 1.4;
    const waveCycles = 2.4;
    const mirrorSplit = 0.68;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');
    const unplayed = this._colorToRGBA(ctx, unplayedColor, 'rgba(255,255,255,0.5)');
    const hoverC = this._colorToRGBA(ctx, hoverPlayed, 'rgba(212,240,64,0.55)');

    const split = h * mirrorSplit;
    const gap = Math.max(2, h * 0.03);
    const maxTopH = (split - gap - 2) * scale;
    const maxBotH = (h - split - gap) * 0.9 * scale;
    const freq = (Math.PI * 2 * waveCycles) / w;
    const playX = (playingPoint / data.length) * w;

    const hov = hoverX >= 0;
    const hx = hov ? hoverX : -1;
    const hLo = hov ? Math.min(playX, hx) : 0;
    const hHi = hov ? Math.max(playX, hx) : -1;
    const inHover = (cx) => hov && cx >= hLo && cx <= hHi;

    const hShiftAmp = (pw + pg) * 0.6;
    const hWaveFreq = (Math.PI * 2 * 1.5) / w;
    const botStart = split + gap;

    ctx.clearRect(0, 0, w, h);

    for (let l = layers - 1; l >= 0; l--) {
      const la = Math.pow(opacityFalloff, l);
      const hsc = 1 + l * heightGrowth;
      const phase = l * wavePhaseShift;
      const lw = pw * (1 - l * 0.04);

      for (let i = 0; i < data.length; i++) {
        const baseX = (w - totalWidth) / 2 + i * (pw + pg);
        const xOff = l * hShiftAmp * (0.5 + 0.5 * Math.sin(baseX * hWaveFreq + l * 0.8));
        const x = baseX + xOff;
        const cx = x + lw / 2;
        const barVal = data[i] / 100;
        const waveMod = 1 + waveAmplitude * Math.sin(baseX * freq + phase);
        const topH = Math.max(1.5, barVal * maxTopH * hsc * waveMod);
        const x0 = x + (pw - lw) / 2;

        let c;
        if (inHover(cx)) {
          c = hoverC;
        } else if (cx <= playX) {
          c = played;
        } else {
          c = unplayed;
        }
        const alpha = (c[3] * la).toFixed(3);
        const full = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
        const fade = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)';

        const topGrad = ctx.createLinearGradient(0, split - gap - topH, 0, split - gap);
        topGrad.addColorStop(0, fade);
        topGrad.addColorStop(0.12, full);
        topGrad.addColorStop(0.88, full);
        topGrad.addColorStop(1, full);
        ctx.fillStyle = topGrad;
        ctx.fillRect(x0, split - gap - topH, lw, topH);
      }
    }

    for (let i = 0; i < data.length; i++) {
      const x = (w - totalWidth) / 2 + i * (pw + pg);
      const cx = x + pw / 2;
      const barVal = data[i] / 100;
      const barH = Math.max(1, barVal * maxBotH);

      let c;
      if (inHover(cx)) {
        c = hoverC;
      } else if (cx <= playX) {
        c = played;
      } else {
        c = unplayed;
      }
      const botGrad = ctx.createLinearGradient(0, botStart, 0, botStart + barH);
      botGrad.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] * 0.5).toFixed(3) + ')');
      botGrad.addColorStop(0.4, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] * 0.2).toFixed(3) + ')');
      botGrad.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
      ctx.fillStyle = botGrad;
      ctx.fillRect(x, botStart, pw, barH);
    }

    ctx.fillStyle = 'rgba(' + played[0] + ',' + played[1] + ',' + played[2] + ',0.85)';
    ctx.fillRect(playX - 0.6, 0, 1.2, h);
  },

   _paintWaveformSquiggle(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor) {
    const mid = h / 2;
    const maxH = h / 2 - 2;
    const playX = (playingPoint / data.length) * w;
    const totalWidth = data.length * (pw + pg);
    const offsetX = (w - totalWidth) / 2;
    const per = pw + pg;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');

    const greyR = Math.round(played[0] * 0.35 + 128 * 0.65);
    const greyG = Math.round(played[1] * 0.35 + 128 * 0.65);
    const greyB = Math.round(played[2] * 0.35 + 128 * 0.65);

    ctx.clearRect(0, 0, w, h);

    const upTips = [];
    const dnTips = [];
    for (let i = 0; i < data.length; i++) {
      const barVal = data[i] / 100;
      const barH = Math.max(2, barVal * maxH);
      const x = offsetX + i * per + pw / 2;
      upTips.push({ x, y: mid - barH });
      dnTips.push({ x, y: mid + barH });
    }

    if (upTips.length < 2) return;
    const drawShape = (from, to, fillColor, strokeColor, lineW) => {
      if (to - from < 2) return;
      ctx.beginPath();
      ctx.moveTo(upTips[from].x, upTips[from].y);
      for (let i = from + 1; i < to; i++) {
        const prev = upTips[i - 1], curr = upTips[i];
        const cpx = (prev.x + curr.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
      }
      ctx.lineTo(upTips[to - 1].x, dnTips[to - 1].y);
      for (let i = to - 2; i >= from; i--) {
        const prev = dnTips[i + 1], curr = dnTips[i];
        const cpx = (prev.x + curr.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
      }
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineW;
      ctx.stroke();
    };

    const splitIdx = upTips.findIndex(t => t.x > playX);
    const playedEnd = splitIdx >= 0 ? splitIdx + 1 : upTips.length;

    if (playedEnd > 1) {
      drawShape(0, playedEnd, playedColor, playedColor, 2.5);
    }

    if (playedEnd >= 2 && playedEnd < upTips.length) {
      const midC = 'rgba(' +
        Math.round(played[0] * 0.55 + greyR * 0.45) + ',' +
        Math.round(played[1] * 0.55 + greyG * 0.45) + ',' +
        Math.round(played[2] * 0.55 + greyB * 0.45) + ',0.45)';
      drawShape(playedEnd - 1, playedEnd + 1, midC, midC, 1.5);
    }

    if (playedEnd + 1 < upTips.length) {
      const unplayedFill = 'rgba(' + greyR + ',' + greyG + ',' + greyB + ',0.28)';
      drawShape(playedEnd, upTips.length, unplayedFill, unplayedFill, 1);
    }
  },

   _paintWaveformSquiggleScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth) {
    const mid = h / 2;
    const maxH = (h / 2 - 2) * scale;
    const playX = (playingPoint / data.length) * w;
    const offsetX = (w - totalWidth) / 2;
    const per = pw + pg;
    const dpr = window.devicePixelRatio || 1;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');
    const hoverC = this._colorToRGBA(ctx, hoverPlayed, 'rgba(212,240,64,0.55)');

    const greyR = Math.round(played[0] * 0.35 + 128 * 0.65);
    const greyG = Math.round(played[1] * 0.35 + 128 * 0.65);
    const greyB = Math.round(played[2] * 0.35 + 128 * 0.65);

    const hov = hoverX >= 0;
    const hLo = hov ? Math.min(playX, hoverX) : 0;
    const hHi = hov ? Math.max(playX, hoverX) : -1;

    ctx.clearRect(0, 0, w, h);

    const upTips = [];
    const dnTips = [];
    for (let i = 0; i < data.length; i++) {
      const barVal = data[i] / 100;
      const barH = Math.max(2, barVal * maxH);
      const x = offsetX + i * per + pw / 2;
      upTips.push({ x, y: mid - barH });
      dnTips.push({ x, y: mid + barH });
    }

    if (upTips.length < 2) return;

    const fadeBars = Math.max(2, Math.round(data.length * 0.015));

    const drawShape = (from, to, fillColor, strokeColor, lineW) => {
      if (to - from < 2) return;
      ctx.beginPath();
      ctx.moveTo(upTips[from].x, upTips[from].y);
      for (let i = from + 1; i < to; i++) {
        const prev = upTips[i - 1], curr = upTips[i];
        const cpx = (prev.x + curr.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
      }
      ctx.lineTo(upTips[to - 1].x, dnTips[to - 1].y);
      for (let i = to - 2; i >= from; i--) {
        const prev = dnTips[i + 1], curr = dnTips[i];
        const cpx = (prev.x + curr.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
      }
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineW;
      ctx.stroke();
    };

    const splitIdx = upTips.findIndex(t => t.x > playX);
    const playedEnd = splitIdx >= 0 ? splitIdx + 1 : upTips.length;

    if (playedEnd > 1) {
      drawShape(0, playedEnd, playedColor, playedColor, 2.5 * dpr);
    }

    if (playedEnd >= 2 && playedEnd < upTips.length) {
      const midC = 'rgba(' +
        Math.round(played[0] * 0.55 + greyR * 0.45) + ',' +
        Math.round(played[1] * 0.55 + greyG * 0.45) + ',' +
        Math.round(played[2] * 0.55 + greyB * 0.45) + ',0.45)';
      drawShape(playedEnd - 1, playedEnd + 1, midC, midC, 1.5 * dpr);
    }

    if (playedEnd + 1 < upTips.length) {
      const unplayedFill = 'rgba(' + greyR + ',' + greyG + ',' + greyB + ',0.28)';
      drawShape(playedEnd, upTips.length, unplayedFill, unplayedFill, 1 * dpr);
    }

    if (hov) {
      const hStart = upTips.findIndex(t => t.x >= hLo);
      const hEnd = upTips.findIndex(t => t.x > hHi);
      const hoverFrom = Math.max(0, hStart);
      const hoverTo = hEnd >= 0 ? hEnd + 1 : upTips.length;
      if (hoverTo - hoverFrom >= 2) {
        drawShape(hoverFrom, hoverTo, 'rgba(' + hoverC[0] + ',' + hoverC[1] + ',' + hoverC[2] + ',0.2)', 'rgba(' + hoverC[0] + ',' + hoverC[1] + ',' + hoverC[2] + ',0.6)', 2 * dpr);
      }
    }
  },

  _loadWaveform(track) {
    if (!track) return;

    const isFirstLoad = !this._waveformData || this._waveformData.length === 0;
    this._waveformProgress = 0;
    this._realWaveform = false;
    this._waveformRawPeaks = null;
    this._currentWaveformTrackId = track.id;
    this._waveformMorphFrom = null;
    this._waveformAnimProgress = 1;

    if (isFirstLoad) {
      this._waveformHeightScale = 0.3;
      this.els.waveformCanvas.classList.add('fading');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.els.waveformCanvas.classList.remove('fading');
          this._animateWaveformScale(1, 400);
        });
      });
    }

    this._generateWaveform(track.id);
    this._paintWaveform(this._waveformProgress || 0);

    const trackId = track.id;
    Api.getWaveform(trackId).then(data => {
      if (!data || !data.peaks || data.peaks.length === 0) return;
      const currentTrack = Player.getCurrentTrack();
      if (!currentTrack || currentTrack.id !== trackId) return;

      this._waveformRawPeaks = data.peaks;
      this._realWaveform = true;
      this._waveformHeightScale = 0.4;
      this._animateWaveformScale(1, 350);
      this._scaleWaveformData();
      this._paintWaveform(this._waveformProgress || 0);
    }).catch(() => {});
  },

  _animateWaveformScale(target, duration) {
    if (this._waveformScaleFrame) cancelAnimationFrame(this._waveformScaleFrame);
    if (this._waveformHeightScale == null) this._waveformHeightScale = 0;
    const from = this._waveformHeightScale;
    const delta = target - from;
    if (Math.abs(delta) < 0.001) {
      this._waveformHeightScale = target;
      this._paintWaveform(this._waveformProgress || 0);
      return;
    }
    const start = performance.now();
    const mass = 1;
    const stiffness = 120;
    const damping = 14;
    const omega = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    let scale = from;
    let velocity = 0;
    const dt = 1 / 60;
    const maxFrames = Math.ceil(duration / 16) + 60;
    let frame = 0;
    const tick = () => {
      const springForce = stiffness * (target - scale);
      const dampForce = -damping * velocity;
      const accel = (springForce + dampForce) / mass;
      velocity += accel * dt;
      scale += velocity * dt;
      this._waveformHeightScale = scale;
      this._paintWaveform(this._waveformProgress || 0);
      frame++;
      const settled = Math.abs(scale - target) < 0.002 && Math.abs(velocity) < 0.01;
      if (!settled && frame < maxFrames) {
        this._waveformScaleFrame = requestAnimationFrame(tick);
      } else {
        this._waveformHeightScale = target;
        this._paintWaveform(this._waveformProgress || 0);
      }
    };
    this._waveformScaleFrame = requestAnimationFrame(tick);
  },

  _getWaveformBarSizes() {
    const w = window.innerWidth;
    if (w < 480) return { pw: 1, pg: 1 };
    if (w < 768) return { pw: 2, pg: 1 };
    return { pw: 3, pg: 1 };
  },

  _scaleWaveformData() {
    if (!this._waveformRawPeaks) return;
    const canvas = this.els.waveformCanvas;
    if (!canvas) return;

    const container = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const { pw, pg } = this._getWaveformBarSizes();
    const numBars = Math.floor(w / (pw + pg));
    const raw = this._waveformRawPeaks;
    const data = [];
    for (let i = 0; i < numBars; i++) {
      const idx = (i / numBars) * raw.length;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, raw.length - 1);
      const frac = idx - lo;
      const val = raw[lo] * (1 - frac) + raw[hi] * frac;
      data.push(Math.max(8, Math.min(100, Math.round(val * 100))));
    }
    this._waveformData = data;
    this._waveformPointWidth = pw;
    this._waveformPointGap = pg;
  },

  _generateWaveform(trackId) {
    const canvas = this.els.waveformCanvas;
    if (!canvas) return;

    const container = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const { pw, pg } = this._getWaveformBarSizes();
    const numPoints = Math.floor(w / (pw + pg));

    const data = [];
    for (let i = 0; i < numPoints; i++) {
      data.push(12);
    }

    this._waveformData = data;
    this._waveformPointWidth = pw;
    this._waveformPointGap = pg;
  },

  _paintWaveform(progressFraction) {
    const canvas = this.els.waveformCanvas;
    if (!canvas || !this._waveformData.length) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const data = this._waveformData;
    const pw = this._waveformPointWidth * (window.devicePixelRatio || 1);
    const pg = this._waveformPointGap * (window.devicePixelRatio || 1);
    const totalWidth = data.length * (pw + pg);

    // Cache CSS custom property reads — getComputedStyle forces style recalc
    // and was called on every paint (~4x/sec from timeupdate + on every seek/hover).
    // Invalidate when the played color changes (album color update sets it).
    const playedKey = document.documentElement.style.getPropertyValue('--waveform-played');
    if (this._wfColorKey !== playedKey) {
      this._wfColorKey = playedKey;
      const sc = getComputedStyle(document.documentElement);
      this._wfPlayedColor = sc.getPropertyValue('--waveform-played').trim() || '#D4F040';
      this._wfUnplayedColor = sc.getPropertyValue('--waveform-unplayed').trim() || 'rgba(255, 255, 255, 0.22)';
      this._wfHoverPlayed = sc.getPropertyValue('--waveform-hover').trim() || 'rgba(212, 240, 64, 0.8)';
    }
    const playedColor = this._wfPlayedColor;
    const unplayedColor = this._wfUnplayedColor;
    const hoverPlayed = this._wfHoverPlayed;
    const hoverUnplayed = 'rgba(255,255,255,0.45)';

    ctx.clearRect(0, 0, w, h);

    const playingPoint = progressFraction * data.length;
    const hoverX = this._waveformHoverX >= 0 ? this._waveformHoverX * (window.devicePixelRatio || 1) : -1;
    const scale = this._waveformHeightScale != null ? this._waveformHeightScale : 1;
    const wfStyle = Store.waveformStyle;

    if (wfStyle === 'mirror') {
      this._paintWaveformMirrorScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth);
    } else if (wfStyle === 'layered') {
      this._paintWaveformLayeredScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth);
    } else if (wfStyle === 'layered-mirror') {
      this._paintWaveformLayeredMirrorScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth);
    } else if (wfStyle === 'squiggle') {
      this._paintWaveformSquiggleScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth);
    } else {
      this._paintWaveformRoundedScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth);
    }
  },

  _paintWaveformRoundedScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth) {
    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      const barH = (val / 100) * h * 0.85 * scale;
      const x = (w - totalWidth) / 2 + i * (pw + pg);
      const y = (h - barH) / 2;

      const isPlayed = i < playingPoint;
      const isHovered = hoverX >= 0 && x <= hoverX && hoverX <= x + pw;

      if (isHovered) {
        ctx.fillStyle = isPlayed ? hoverPlayed : hoverUnplayed;
      } else if (isPlayed) {
        ctx.fillStyle = playedColor;
      } else {
        ctx.fillStyle = unplayedColor;
      }

      const radius = Math.min(pw / 2, barH / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + pw - radius, y);
      ctx.arcTo(x + pw, y, x + pw, y + radius, radius);
      ctx.lineTo(x + pw, y + barH - radius);
      ctx.arcTo(x + pw, y + barH, x + pw - radius, y + barH, radius);
      ctx.lineTo(x + radius, y + barH);
      ctx.arcTo(x, y + barH, x, y + barH - radius, radius);
      ctx.lineTo(x, y + radius);
      ctx.arcTo(x, y, x + radius, y, radius);
      ctx.closePath();
      ctx.fill();
    }
  },

  _paintWaveformMirrorScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth) {
    const mid = h * 0.68;
    const gap = Math.max(1, h * 0.02);
    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      const topH = (val / 100) * mid * 0.92 * scale;
      const botH = (val / 100) * (h - mid) * 0.92 * scale;
      const x = (w - totalWidth) / 2 + i * (pw + pg);

      const isPlayed = i < playingPoint;
      const isHovered = hoverX >= 0 && x <= hoverX && hoverX <= x + pw;

      let topColor, botColorStart;
      if (isHovered) {
        topColor = isPlayed ? hoverPlayed : hoverUnplayed;
        botColorStart = isPlayed ? this._colorAlpha(hoverPlayed, 0.5) : this._colorAlpha(hoverUnplayed, 0.2);
      } else if (isPlayed) {
        topColor = playedColor;
        botColorStart = this._colorAlpha(playedColor, 0.5);
      } else {
        topColor = unplayedColor;
        botColorStart = this._colorAlpha(unplayedColor, 0.2);
      }

      const rTop = Math.min(pw / 2, topH / 2);
      ctx.fillStyle = topColor;
      ctx.beginPath();
      ctx.moveTo(x + rTop, mid - gap - topH);
      ctx.lineTo(x + pw - rTop, mid - gap - topH);
      ctx.arcTo(x + pw, mid - gap - topH, x + pw, mid - gap - topH + rTop, rTop);
      ctx.lineTo(x + pw, mid - gap);
      ctx.lineTo(x, mid - gap);
      ctx.lineTo(x, mid - gap - topH + rTop);
      ctx.arcTo(x, mid - gap - topH, x + rTop, mid - gap - topH, rTop);
      ctx.closePath();
      ctx.fill();

      const rBot = Math.min(pw / 2, botH / 2);
      const botTop = mid + gap;
      const botBot = mid + gap + botH;
      const grad = ctx.createLinearGradient(0, botTop, 0, botBot);
      grad.addColorStop(0, botColorStart);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, botTop);
      ctx.lineTo(x + pw, botTop);
      ctx.lineTo(x + pw, botBot - rBot);
      ctx.arcTo(x + pw, botBot, x + pw - rBot, botBot, rBot);
      ctx.lineTo(x + rBot, botBot);
      ctx.arcTo(x, botBot, x, botBot - rBot, rBot);
      ctx.lineTo(x, botTop);
      ctx.closePath();
      ctx.fill();
    }
  },

});
