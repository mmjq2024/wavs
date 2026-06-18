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
    grad.addColorStop(0,   '#edfaf4'); // near-white with green tint at top
    grad.addColorStop(0.4, '#3399aa'); // turquoise mid
    grad.addColorStop(1,   '#0d1e22'); // dark teal at base
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  function starfieldSetup(W, H) {
    var stars = [];
    for (var i = 0; i < 180; i++) {
      stars.push({
        x:     Math.random() * W,
        y:     Math.random() * H,
        r:     0.4 + Math.random() * 1.1,
        base:  0.25 + Math.random() * 0.75,
        phase: Math.random() * Math.PI * 2,
        speed: 0.015 + Math.random() * 0.035,
      });
    }
    return { stars: stars, t: 0 };
  }

  function starfieldDraw(ctx, W, H, bg) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    bg.t++;
    for (var i = 0; i < bg.stars.length; i++) {
      var s = bg.stars[i];
      var alpha = s.base * (0.6 + 0.4 * Math.sin(s.phase + bg.t * s.speed));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Bar style factory
  // ---------------------------------------------------------------------------

  // Creates a bar-type style. All current styles share the same rendering
  // logic; they differ only in bar geometry, gradient colours, peak options,
  // and growth direction (hangFromTop flips bars to hang from the ceiling
  // instead of rising from the floor — same gradient, mirrored anchor).
  // bgSetup(W,H) and bgDraw(ctx,W,H,bgState) are optional background callbacks.
  function createBarStyle(name, barWidth, barGap, showPeaks, stops, peakColor, hangFromTop, floatPeaks, bgSetup, bgDraw) {

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

        return {
          numBars:      numBars,
          offscreen:    off,
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

        for (let i = 0; i < numBars; i++) {
          const barH = Math.round((getBarLevel(bins, i, buf) / 255) * H);
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
      'Mountain', 2, 0, false,
      [[0, '#ffffff'], [0.2, '#ff88ff'], [0.45, '#4488ff'], [0.7, '#00ffcc'], [1, '#006644']],
      null, false, false, skyGradientSetup, skyGradientDraw
    ),
    createBarStyle(
      'Night Mountain', 2, 0, false,
      [[0, '#aabbdd'], [0.2, '#662288'], [0.45, '#2255aa'], [0.7, '#009977'], [1, '#003322']],
      null, false, false, starfieldSetup, starfieldDraw
    ),
    createBarStyle(
      'Flame', 3, 0, true,
      [[0, '#550044'], [0.25, '#003399'], [0.5, '#66aaff'], [0.75, '#ff6600'], [1, '#ffee00']],
      '#ff4400', false, true
    )
  );

})();
