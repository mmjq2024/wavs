// Sparkler visualization style for the Classic Spectrum Analyzer.
// Simulates standing at the edge of a very large circle and looking along its
// rim. The circle's centre sits far below the canvas, so the visible arc
// appears nearly flat. Each bar radiates outward (upward) perpendicular to
// that arc; the slight curvature is most visible at the left and right edges.
(function () {

  const MIN_FREQ = 20;
  const MAX_FREQ = 20000;
  const NUM_BARS = 200;
  const PARTICLE_SPEED = 0.5;  // px/frame the dot drifts outward after launch
  const PARTICLE_FADE  = 0.012; // opacity lost per frame (full fade ≈ 83 frames)

  // Radius of the large imaginary circle. Larger = flatter arc / more zoomed in.
  const BIG_R = 600;
  // How many pixels the arc's crest sits above the canvas bottom at centre.
  // Raising this reveals more curvature; lowering it hides the arc below the edge.
  const ARC_REVEAL = 20;

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  function computeBins(numBars, bufLen, sampleRate) {
    const nyquist  = sampleRate / 2;
    const logMin   = Math.log(MIN_FREQ);
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

  function getBarLevel(bins, i, buf) {
    const start = bins[i];
    const end   = Math.max(start, bins[i + 1] - 1);
    let sum = 0;
    for (let b = start; b <= end; b++) sum += buf[b];
    return sum / (end - start + 1);
  }

  // Maps a normalised position (0 = base, 1 = tip) to a sparkler colour,
  // matching the bar gradient: white → bright yellow → amber-gold → champagne.
  function sparklerColor(t) {
    var r, g, b;
    if (t < 0.25) {
      var s = t / 0.25;                  // white → bright yellow
      r = 255;
      g = Math.round(255 - s * 17);     // 255 → 238
      b = Math.round(255 - s * 119);    // 255 → 136
    } else if (t < 0.65) {
      var s = (t - 0.25) / 0.4;         // bright yellow → amber-gold
      r = 255;
      g = Math.round(238 - s * 85);     // 238 → 153
      b = Math.round(136 - s * 136);    // 136 → 0
    } else {
      var s = (t - 0.65) / 0.35;        // amber-gold → champagne
      r = Math.round(255 - s * 23);     // 255 → 232
      g = Math.round(153 - s * 41);     // 153 → 112
      b = Math.round(0   + s * 32);     // 0   → 32
    }
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // ---------------------------------------------------------------------------
  // Style registration
  // ---------------------------------------------------------------------------

  (window.SpectrumStyles = window.SpectrumStyles || []).push({
    name: 'Sparkler',

    settings: [
      {
        type: 'group',
        justify: 'flex-start',
        settings: [
          { id: 'peaks',  type: 'toggle', label: 'Sparks', default: true  },
          { id: 'mirror', type: 'toggle', label: 'Mirror', default: true },
        ],
      },
    ],

    setup: function (ctx, W, H) {
      return {
        numBars:      NUM_BARS,
        bins:         null,
        peaks:        new Float32Array(NUM_BARS), // particle's current radial position
        peakVels:     new Float32Array(NUM_BARS), // outward velocity
        peakAlphas:   new Float32Array(NUM_BARS), // opacity (0 = inactive)
        peakAmps:     new Float32Array(NUM_BARS), // amplitude captured at launch
        launchLens:   new Float32Array(NUM_BARS), // bar length at last launch (not drifting)
      };
    },

    initBins: function (resources, bufLen, sampleRate) {
      resources.bins = computeBins(resources.numBars, bufLen, sampleRate);
    },

    render: function (ctx, W, H, buf, resources, params) {
      if (!resources.bins) return;

      const { numBars, bins, peaks, peakVels, peakAlphas, peakAmps, launchLens } = resources;
      const showPeaks = params.peaks;
      const mirror    = params.mirror;

      // Raise the centre by ARC_REVEAL so the rim crests that many pixels above
      // the canvas bottom, making the curvature faintly visible.
      const cx    = W / 2;
      const cy    = H + BIG_R - ARC_REVEAL;
      const maxBarH = H - 4; // tallest a bar can reach above the canvas bottom

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      // Gradient anchored to the actual bar base (y = H − ARC_REVEAL) so the
      // root is pure white. Stops are vivid so the transition reads clearly.
      const barGrad = ctx.createLinearGradient(0, H - ARC_REVEAL, 0, 0);
      barGrad.addColorStop(0,    '#ffffff');   // white-hot at base
      barGrad.addColorStop(0.25, '#ffee88');   // bright warm yellow
      barGrad.addColorStop(0.65, '#ff9900');   // vivid amber-gold
      barGrad.addColorStop(1,    '#e87020');   // champagne at tip

      // Draw the large circle's rim and fill its interior white. The path traces
      // the arc across the canvas, then closes along the bottom edge so the
      // region below the arc (inside the circle) is filled.
      ctx.beginPath();
      for (let j = 0; j < numBars; j++) {
        const ax   = (j / (numBars - 1)) * W;
        const aSin = (ax - cx) / BIG_R;
        const aCos = Math.sqrt(Math.max(0, 1 - aSin * aSin));
        const ay   = cy - BIG_R * aCos;
        if (j === 0) ctx.moveTo(ax, ay); else ctx.lineTo(ax, ay);
      }
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();

      for (let i = 0; i < numBars; i++) {
        // Mirror mode: both halves show the same spectrum symmetrically,
        // bass at the outer edges meeting treble at the centre.
        const freqIdx = mirror ? Math.min(i, numBars - 1 - i) : i;
        const rawAmp  = getBarLevel(bins, freqIdx, buf) / 255;
        const barLen  = rawAmp * maxBarH;

        // Launch when: no particle is active, OR bar rises well above the last
        // launch height. launchLens tracks the fixed launch position (not the
        // drifting peaks[i]), so it doesn't race ahead of the bar each frame.
        // When a particle fades, launchLens resets to zero so any bar activity
        // immediately fires a new particle.
        const noParticle = peakAlphas[i] <= 0;
        const newHigh    = barLen > launchLens[i] + 5;
        if (barLen > 2 && (noParticle || newHigh)) {
          launchLens[i] = barLen;
          peaks[i]      = barLen;
          peakVels[i]   = PARTICLE_SPEED;
          peakAlphas[i] = 1.0;
          peakAmps[i]   = rawAmp;
        } else if (peakAlphas[i] > 0) {
          peaks[i]      += peakVels[i];
          peakAlphas[i]  = Math.max(0, peakAlphas[i] - PARTICLE_FADE);
          if (peakAlphas[i] <= 0) launchLens[i] = 0; // reset so next activity relaunches
        }

        // Distribute bars evenly across the canvas width, then project each
        // x position onto the large circle to find the outward direction.
        const x        = (i / (numBars - 1)) * W;
        const sinTheta = (x - cx) / BIG_R;          // horizontal component
        const cosTheta = Math.sqrt(1 - sinTheta * sinTheta); // vertical component

        // Base of bar: the point on the large circle (just at/below the bottom edge).
        const baseX = x;
        const baseY = cy - BIG_R * cosTheta; // ≈ H, dips slightly at the edges

        // The outward (upward) unit vector at this point on the circle.
        // In screen coords (y downward): outward = (sinTheta, −cosTheta).
        if (barLen > 0) {
          ctx.strokeStyle = barGrad;
          ctx.lineWidth   = 1.5;
          ctx.beginPath();
          ctx.moveTo(baseX,                   baseY);
          ctx.lineTo(baseX + sinTheta * barLen, baseY - cosTheta * barLen);
          ctx.stroke();
        }

        if (showPeaks && peakAlphas[i] > 0) {
          ctx.globalAlpha = peakAlphas[i];
          ctx.fillStyle   = sparklerColor(peakAmps[i]);
          ctx.beginPath();
          ctx.arc(
            baseX + sinTheta * peaks[i],
            baseY - cosTheta * peaks[i],
            1.5, 0, Math.PI * 2
          );
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    },

    reset: function (resources) {
      resources.peaks.fill(0);
      resources.peakVels.fill(0);
      resources.peakAlphas.fill(0);
      resources.peakAmps.fill(0);
      resources.launchLens.fill(0);
    },
  });

})();
