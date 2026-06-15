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
  // Bar style factory
  // ---------------------------------------------------------------------------

  // Creates a bar-type style. All three current styles share the same rendering
  // logic; they differ only in bar geometry, gradient colours, and peak options.
  function createBarStyle(name, barWidth, barGap, showPeaks, stops, peakColor) {

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
          numBars: numBars,
          offscreen: off,
          bins: null,                          // set by initBins()
          peaks: new Array(numBars).fill(0),   // current peak height in pixels
          holdCounters: new Array(numBars).fill(0), // hold frames remaining
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

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < numBars; i++) {
          const barH = Math.round((getBarLevel(bins, i, buf) / 255) * H);
          const x = i * (barWidth + barGap);

          if (barH > 0) {
            // Blend between two gradient sampling modes by interpolating the
            // source rect within the offscreen gradient canvas:
            //   blend=0 (positional): sample the slice at the bar's canvas height.
            //   blend=1 (per-bar):    sample the full gradient stretched to the bar.
            const srcY = (H - barH) * (1 - blend);
            const srcH = barH + (H - barH) * blend;
            ctx.drawImage(off, 0, srcY, 1, srcH, x, H - barH, barWidth, barH);
          }

          if (showPeaks) {
            // Peak dots snap to the new high instantly, hold for a fixed number
            // of frames, then fall at a constant pixel rate.
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
              ctx.fillRect(x, H - Math.round(peaks[i]), barWidth, 1);
            }
          }
        }
      },

      // Resets peak state when the user switches away from and back to this style.
      reset: function (resources) {
        resources.peaks.fill(0);
        resources.holdCounters.fill(0);
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
      null
    ),
    createBarStyle(
      'Flame', 3, 1, true,
      [[0, '#7700cc'], [0.25, '#003399'], [0.5, '#66aaff'], [0.75, '#ff6600'], [1, '#ffee00']],
      '#5a0044'
    )
  );

  // ---------------------------------------------------------------------------
  // Aurora — animated scrolling gradient, no bar gaps
  // ---------------------------------------------------------------------------
  // Two repeats of the colour pattern are baked into a 1×(2H) offscreen canvas.
  // Each frame we advance a scroll counter and sample a barH-tall strip starting
  // at `scroll`, giving a slow upward drift of colour through every bar.

  (window.SpectrumStyles = window.SpectrumStyles || []).push({
    name: 'Aurora',

    settings: [],

    setup: function (ctx, W, H) {
      const barWidth = 2;
      const numBars  = Math.floor(W / barWidth);

      // Bake two full pattern repetitions so scroll never overruns the canvas
      // (scroll < H, barH <= H, so sy + sh = scroll + barH < 2H always).
      const off    = document.createElement('canvas');
      off.width    = 1;
      off.height   = H * 2;
      const offCtx = off.getContext('2d');
      const g      = offCtx.createLinearGradient(0, 0, 0, H * 2);
      g.addColorStop(0,     '#000000');
      g.addColorStop(0.125, '#99ff99');  // light green
      g.addColorStop(0.25,  '#000000');
      g.addColorStop(0.375, '#004400');  // dark green
      g.addColorStop(0.5,   '#000000');
      g.addColorStop(0.625, '#99ff99');
      g.addColorStop(0.75,  '#000000');
      g.addColorStop(0.875, '#004400');
      g.addColorStop(1.0,   '#000000');
      offCtx.fillStyle = g;
      offCtx.fillRect(0, 0, 1, H * 2);

      return { numBars: numBars, bins: null, offscreen: off, barWidth: barWidth, time: 0,
               smoothed: new Float32Array(numBars) };
    },

    initBins: function (resources, bufLen, sampleRate) {
      resources.bins = computeBins(resources.numBars, bufLen, sampleRate);
    },

    render: function (ctx, W, H, buf, resources, params) {
      if (!resources.bins) return;
      const { numBars, bins, offscreen, barWidth } = resources;

      // Advance scroll ~0.1 px/frame → one full colour cycle every ~33 s at 60 fps.
      resources.time++;
      const scroll = Math.floor(resources.time * 0.1) % H;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      const smoothed = resources.smoothed;
      for (let i = 0; i < numBars; i++) {
        const raw = getBarLevel(bins, i, buf) / 255;
        // Snap up to new highs immediately; decay slowly so bars linger.
        smoothed[i] = raw > smoothed[i] ? raw : smoothed[i] * 0.97;
        const barH = Math.round(smoothed[i] * H);
        if (barH === 0) continue;
        // Sample a barH-tall strip from the scrolling gradient and stretch it
        // horizontally to barWidth, mapping tip→base of bar.
        ctx.drawImage(offscreen, 0, scroll, 1, H, i * barWidth, 0, barWidth, barH);
      }
    },

    reset: function (resources) {
      resources.time = 0;
      resources.smoothed.fill(0);
    },
  });

})();
