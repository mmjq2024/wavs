// Bar visualization styles for the Classic Spectrum Analyzer.
// Registers Classic, Monochrome, and Mountain styles on window.SpectrumStyles.
// Must be loaded before spectrum-analyzer.js.
(function () {

  const MIN_FREQ = 20;
  const MAX_FREQ = 20000;
  const PEAK_HOLD_FRAMES = 30;
  const PEAK_DECAY = 0.5;

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  // Maps bar indices to FFT bin ranges using a logarithmic frequency scale
  // between MIN_FREQ and MAX_FREQ. The extra entry at [numBars] stores the
  // upper boundary of the last bar so getBarLevel can compute ranges cleanly.
  function computeBins(numBars, bufLen, sampleRate) {
    const nyquist = sampleRate / 2;
    const logMin = Math.log(MIN_FREQ);
    const logRange = Math.log(MAX_FREQ / MIN_FREQ);
    const bins = new Int32Array(numBars + 1);
    for (let i = 0; i <= numBars; i++) {
      bins[i] = Math.min(
        Math.floor(Math.exp(logMin + logRange * i / numBars) / nyquist * bufLen),
        bufLen - 1
      );
    }
    return bins;
  }

  // Averages all FFT bins in bar i's frequency range, preventing aliasing at
  // high frequencies where a single bar can span many bins.
  function getBarLevel(bins, i, buf) {
    const start = bins[i];
    const end = Math.max(start, bins[i + 1] - 1);
    let sum = 0;
    for (let b = start; b <= end; b++) sum += buf[b];
    return sum / (end - start + 1);
  }

  // ---------------------------------------------------------------------------
  // Backgrounds (Mountain / Night Mountain)
  // ---------------------------------------------------------------------------

  function skyGradientSetup(W, H) {
    return {};
  }

  function skyGradientDraw(ctx, W, H, bg) {
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0,   '#e8eef0'); // pale blue-gray at top
    grad.addColorStop(0.4, '#5a7a80'); // muted teal-gray mid
    grad.addColorStop(1,   '#141b1d'); // near-black with slight teal at base
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  function twilightBgDraw(ctx, W, H, bg) {
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1a1820');
    grad.addColorStop(1, '#080608');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------------------
  // Bar style factory
  // ---------------------------------------------------------------------------

  // Creates a bar-type style. All current styles share the same rendering
  // logic; they differ only in bar geometry, gradient colours, peak options,
  // and growth direction (hangFromTop flips bars to hang from the ceiling
  // instead of rising from the floor — same gradient, mirrored anchor).
  // bgSetup(W,H) and bgDraw(ctx,W,H,bgState) are optional background callbacks.
  function createBarStyle(name, barWidth, barGap, showPeaks, stops, peakColor, hangFromTop, floatPeaks, bgSetup, bgDraw, mirror, mirrorStops) {

    return {
      name: name,

      // Settings declared here appear automatically in the engine's settings UI.
      // The engine passes current values to render() as params.
      settings: [
        {
          id: 'gradientBlend',
          type: 'range',
          label: 'Gradient',
          min: 0, max: 1, step: 0.01, default: 1,
          labelMin: 'Positional',
          labelMax: 'Per-bar',
        },
      ],

      // Called once at startup. Builds the offscreen gradient canvas and
      // allocates peak state. bins is populated later by initBins().
      setup: function (ctx, W, H) {
        const numBars = Math.floor((W + barGap) / (barWidth + barGap));

        // Bake the gradient into a 1×H offscreen canvas so drawImage can
        // stretch any slice of it onto each bar without creating new gradient
        // objects every frame.
        const off = document.createElement('canvas');
        off.width = 1;
        off.height = H;
        const offCtx = off.getContext('2d');
        const g = offCtx.createLinearGradient(0, 0, 0, H);
        stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
        offCtx.fillStyle = g;
        offCtx.fillRect(0, 0, 1, H);

        // For mirror mode: bake the gradient reversed so reflection bars read
        // bright-at-bottom (reflection of the mountain peak pointing downward).
        var offFlipped = null;
        if (mirror) {
          offFlipped = document.createElement('canvas');
          offFlipped.width  = 1;
          offFlipped.height = H;
          var offFlippedCtx = offFlipped.getContext('2d');
          var gFlipped = offFlippedCtx.createLinearGradient(0, 0, 0, H);
          var rStops = mirrorStops || stops.map(function (s) { return [1 - s[0], s[1]]; });
          rStops.forEach(function (s) { gFlipped.addColorStop(s[0], s[1]); });
          offFlippedCtx.fillStyle = gFlipped;
          offFlippedCtx.fillRect(0, 0, 1, H);
        }

        return {
          numBars:      numBars,
          offscreen:    off,
          offFlipped:   offFlipped,
          bins:         null,
          peaks:        new Array(numBars).fill(0),
          holdCounters: new Array(numBars).fill(0),
          peakAlphas:   floatPeaks ? new Float32Array(numBars) : null,
          peakVels:     floatPeaks ? new Float32Array(numBars) : null,
          bgState:      bgSetup ? bgSetup(W, H) : null,
        };
      },

      // Called once after the AudioContext is ready, because frequencyBinCount
      // and sampleRate depend on the browser / audio device.
      initBins: function (resources, bufLen, sampleRate) {
        resources.bins = computeBins(resources.numBars, bufLen, sampleRate);
      },

      // Called every animation frame. Clears the canvas and draws bars.
      // params carries the current values of this style's declared settings.
      render: function (ctx, W, H, buf, resources, params) {
        if (!resources.bins) return; // audio not yet initialised

        const numBars = resources.numBars;
        const off = resources.offscreen;
        const bins = resources.bins;
        const peaks = resources.peaks;
        const holdCounters = resources.holdCounters;
        const blend = params.gradientBlend;

        if (bgDraw && resources.bgState) {
          bgDraw(ctx, W, H, resources.bgState);
        } else {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, W, H);
        }

        if (mirror) {
          const waterY = Math.round(H * 2 / 3);

          // Water: a reversed sky gradient fills the lower third, creating the
          // impression of a calm lake reflecting the sky above the waterline.
          const waterBg = ctx.createLinearGradient(0, H, 0, waterY);
          waterBg.addColorStop(0,    '#e0eaed'); // reflected bright sky at canvas bottom
          waterBg.addColorStop(0.55, '#6a9aa8'); // reflected mid sky
          waterBg.addColorStop(1,    '#527888'); // darkens toward the waterline
          ctx.fillStyle = waterBg;
          ctx.fillRect(0, waterY, W, H - waterY);

          // Waterline: thin luminous seam separating mountain from reflection.
          ctx.fillStyle = 'rgba(210, 228, 232, 0.55)';
          ctx.fillRect(0, waterY - 1, W, 2);

          const offFlipped = resources.offFlipped;
          for (let i = 0; i < numBars; i++) {
            const t    = i / numBars;
            const eq   = 0.4 + 2.0 * Math.pow(t, 1.2);
            const barH = Math.round(Math.min(1, getBarLevel(bins, i, buf) / 255 * eq) * waterY);
            const x    = i * (barWidth + barGap);

            if (barH > 0) {
              // Mountain bar (upper zone): rises upward from the waterline.
              // Full gradient stretched to barH so peaks stay bright regardless of height.
              ctx.drawImage(off,        0, 0, 1, H, x, waterY - barH, barWidth, barH);

              // Reflection bar: reversed gradient, dimmer, hangs downward.
              // Allowed to run off the bottom of the canvas.
              ctx.globalAlpha = 0.45;
              ctx.drawImage(offFlipped, 0, 0, 1, H, x, waterY,         barWidth, barH);
              ctx.globalAlpha = 1;
            }
          }
          return;
        }

        for (let i = 0; i < numBars; i++) {
          // Visual EQ: high frequencies have naturally less energy in music, so
          // we apply a position-dependent gain. t=0 (bass) gets 0.5× to reduce
          // dominance; t=1 (treble) gets 3× to lift quiet high-end activity.
          const t    = i / numBars;
          const eq   = 0.4 + 2.0 * Math.pow(t, 1.2);
          const barH = Math.round(Math.min(1, getBarLevel(bins, i, buf) / 255 * eq) * H);
          const x = i * (barWidth + barGap);

          const y = hangFromTop ? 0 : H - barH;

          if (barH > 0) {
            // Blend between two gradient sampling modes by interpolating the
            // source rect within the offscreen gradient canvas:
            //   blend=0 (positional): sample the slice at the bar's canvas height.
            //   blend=1 (per-bar):    sample the full gradient stretched to the bar.
            const srcY = (H - barH) * (1 - blend);
            const srcH = barH + (H - barH) * blend;
            ctx.drawImage(off, 0, srcY, 1, srcH, x, y, barWidth, barH);
          }

          if (showPeaks) {
            if (floatPeaks) {
              // Floating embers: launch upward from the bar tip, fade as they rise.
              // Relaunch whenever the bar is active and no ember is currently floating.
              const alphas = resources.peakAlphas;
              const vels   = resources.peakVels;
              if (barH > 2 && (alphas[i] <= 0 || barH >= peaks[i])) {
                peaks[i]  = barH;
                alphas[i] = 1.0;
                const speed = 0.4 + Math.random() * 0.5;
                vels[i]   = Math.random() < 0.7 ? speed : -speed;
              } else if (alphas[i] > 0) {
                peaks[i]  += vels[i];
                alphas[i]   = Math.max(0, alphas[i] - 0.018);
                if (alphas[i] <= 0 || peaks[i] <= 0) peaks[i] = 0; // reset on fade or floor
              }
              if (alphas[i] > 0 && peaks[i] <= H) {
                ctx.globalAlpha = alphas[i];
                ctx.fillStyle   = peakColor;
                ctx.fillRect(x, H - Math.round(peaks[i]), barWidth, 1);
                ctx.globalAlpha = 1;
              }
            } else {
              // Classic peaks: snap to high, hold, then fall.
              if (barH >= peaks[i]) {
                peaks[i] = barH;
                holdCounters[i] = PEAK_HOLD_FRAMES;
              } else if (holdCounters[i] > 0) {
                holdCounters[i]--;
              } else {
                peaks[i] = Math.max(0, peaks[i] - PEAK_DECAY);
              }
              if (peaks[i] > 0) {
                ctx.fillStyle = peakColor;
                const peakY = hangFromTop ? Math.round(peaks[i]) : H - Math.round(peaks[i]);
                ctx.fillRect(x, peakY, barWidth, 1);
              }
            }
          }
        }
      },

      // Resets peak state when the user switches away from and back to this style.
      reset: function (resources) {
        resources.peaks.fill(0);
        resources.holdCounters.fill(0);
        if (resources.peakAlphas) resources.peakAlphas.fill(0);
        if (resources.peakVels)   resources.peakVels.fill(0);
        if (resources.bgState)    resources.bgState.t = 0;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Frost colour palettes
  // ---------------------------------------------------------------------------

  var FROST_PALETTES = {
    Blue:   { bgEnd: '#c8e4f4', light: '#a8c8e0', mid: '#5090b8', dark: '#142838' },
    Red:    { bgEnd: '#fce8e8', light: '#e89090', mid: '#c03030', dark: '#6b1010' },
    Orange: { bgEnd: '#fdeedd', light: '#e8a870', mid: '#c06010', dark: '#6b2e08' },
    Yellow: { bgEnd: '#fef9cc', light: '#e8d870', mid: '#b89000', dark: '#5a4800' },
    Green:  { bgEnd: '#d4eedd', light: '#80c090', mid: '#2a7a3a', dark: '#0a2e10' },
    Purple: { bgEnd: '#e8d8f4', light: '#b888d8', mid: '#6a30a0', dark: '#2a0a4a' },
  };

  // ---------------------------------------------------------------------------
  // Style registration
  // ---------------------------------------------------------------------------

  (window.SpectrumStyles = window.SpectrumStyles || []).push(
    createBarStyle(
      'Classic', 3, 1, true,
      [[0, '#ff0000'], [0.5, '#ffff00'], [1, '#00ff00']],
      '#ffffff'
    ),
    createBarStyle(
      'Monochrome', 3, 1, true,
      [[0, '#ffffff'], [1, '#444444']],
      '#00ff88'
    ),
    createBarStyle(
      'Twilight', 4, 1, false,
      [[0, '#ddeef8'], [0.2, '#cc66cc'], [0.45, '#3366bb'], [0.7, '#00c4d8'], [1, '#004d33']],
      null, false, false, skyGradientSetup, twilightBgDraw
    ),
    createBarStyle(
      'Gloss', 4, 1, false,
      [[0, '#c0cccc'], [0.2, '#8899aa'], [0.45, '#507070'], [0.7, '#2e5050'], [1, '#1a3030']],
      null, false, false, skyGradientSetup, skyGradientDraw, true,
      [[0, '#3e6878'], [0.45, '#5a90a2'], [1, '#aaccd6']]
    ),
    {
      name: 'Dark Matter',
      settings: [
        {
          id: 'color',
          type: 'select',
          label: 'Color',
          options: ['Blue', 'Red', 'Orange', 'Yellow', 'Green', 'Purple'],
          default: 'Blue',
        },
      ],
      setup: function (ctx, W, H) {
        return {
          numBars:      Math.floor(W / 2),
          bins:         null,
          offscreen:    null,
          lastColor:    null,
          rays:         [],
          smoothEnergy: 0,
        };
      },
      initBins: function (resources, bufLen, sampleRate) {
        resources.bins = computeBins(resources.numBars, bufLen, sampleRate);
      },
      render: function (ctx, W, H, buf, resources, params) {
        if (!resources.bins) return;
        const color   = params.color || 'Blue';
        const palette = FROST_PALETTES[color];

        // Rebuild the bar gradient canvas whenever the colour selection changes.
        if (color !== resources.lastColor) {
          const off    = document.createElement('canvas');
          off.width    = 1;
          off.height   = H;
          const offCtx = off.getContext('2d');
          const g      = offCtx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0,    '#ffffff');
          g.addColorStop(0.35, palette.light);
          g.addColorStop(0.65, palette.mid);
          g.addColorStop(0.85, palette.dark);
          g.addColorStop(1,    '#000000');
          offCtx.fillStyle = g;
          offCtx.fillRect(0, 0, 1, H);
          resources.offscreen = off;
          resources.lastColor = color;
        }

        // Background: white at top, very light tint at bottom.
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#ffffff');
        bg.addColorStop(1, palette.bgEnd);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const bins    = resources.bins;
        const numBars = resources.numBars;

        // Bars.
        const off = resources.offscreen;
        for (let i = 0; i < numBars; i++) {
          const t    = i / numBars;
          const eq   = 0.5 + 2.4 * Math.pow(t, 1.2);
          const barH = Math.round(Math.min(1, getBarLevel(bins, i, buf) / 255 * eq) * H);
          if (barH > 0) {
            ctx.drawImage(off, 0, 0, 1, H, i * 2, H - barH, 2, barH);
          }
        }

        // Compute overall energy (shared by both particle systems).
        let energy = 0;
        for (let i = 0; i < numBars; i++) {
          const teq = 0.5 + 2.4 * Math.pow(i / numBars, 1.2);
          energy += Math.min(1, getBarLevel(bins, i, buf) / 255 * teq);
        }
        energy /= numBars;
        resources.smoothEnergy = resources.smoothEnergy * 0.88 + energy * 0.12;

        // Cosmic rays — streaks shooting both into and out of the dark matter.
        // Spawn rate scales with energy for a steady sense of exchange.
        const rays = resources.rays;
        if (rays.length < 16 && Math.random() < Math.max(0.02, energy * 0.22)) {
          const depth = Math.random();                   // 0 = far/subtle, 1 = close/prominent
          const len   = 25 + depth * 70;
          const dir   = Math.random() < 0.5 ? 1 : -1;
          rays.push({
            x:     Math.random() * W,
            y:     dir === 1 ? -len : H + len,
            spd:   7 + depth * 12,
            len,
            dir,
            depth,
            age:   0,
          });
        }
        for (let ri = rays.length - 1; ri >= 0; ri--) {
          const ray  = rays[ri];
          const fade = Math.max(0, 1 - ray.age / 55);
          ctx.globalAlpha = (0.15 + ray.depth * 0.55) * fade;
          ctx.lineWidth   = 0.5 + ray.depth * 1.5;
          ctx.strokeStyle = palette.mid;
          ctx.beginPath();
          ctx.moveTo(ray.x, ray.y - ray.dir * ray.len);
          ctx.lineTo(ray.x, ray.y);
          ctx.stroke();
          ray.y += ray.dir * ray.spd;
          ray.age++;
          const gone = ray.dir === 1 ? ray.y - ray.len > H : ray.y + ray.len < 0;
          if (gone || ray.age > 70) rays.splice(ri, 1);
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth   = 1;
      },
      reset: function (resources) {
        resources.lastColor    = null;
        resources.rays         = [];
        resources.smoothEnergy = 0;
      },
    },
    createBarStyle(
      'Flame', 3, 0, true,
      [[0, '#550044'], [0.25, '#003399'], [0.5, '#66aaff'], [0.75, '#ff6600'], [1, '#ffee00']],
      '#ff4400', false, true
    )
  );

})();
