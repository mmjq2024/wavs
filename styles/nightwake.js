// 3D Waterfall visualization style for the Classic Spectrum Analyzer.
//
// Axes:
//   X — frequency, low pitch (left / X corner) to high pitch (right / Y corner)
//   Z — time, current frame at the front receding into depth
//   Y — amplitude, quiet at the base rising to the loudest corner at the top
//
// Rendered on a 2D canvas using perspective projection (painter's algorithm,
// back-to-front). Each depth layer is drawn as an outlined silhouette with a
// gradient stroke — dark navy at the base, bright sky-blue at the crests —
// giving the visualization a deep-water look.
(function () {

  const MIN_FREQ = 20;
  const MAX_FREQ = 20000;
  const NUM_BARS = 128; // frequency resolution; halve for performance, double for detail
  const HISTORY  = 50;  // frames retained for the waterfall depth

  // ---------------------------------------------------------------------------
  // Shared helpers (same log-scale bin mapping used by bars.js)
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

  // ---------------------------------------------------------------------------
  // Style registration
  // ---------------------------------------------------------------------------

  (window.SpectrumStyles = window.SpectrumStyles || []).push({
    name: 'Night Wake',

    settings: [],

    setup: function (ctx, W, H) {
      return {
        numBars:     NUM_BARS,
        bins:        null,
        history:     [],
        glowEnergy:  0,
        glints:      [],
      };
    },

    initBins: function (resources, bufLen, sampleRate) {
      resources.bins = computeBins(resources.numBars, bufLen, sampleRate);
    },

    render: function (ctx, W, H, buf, resources, params) {
      if (!resources.bins) return;

      const numBars    = resources.numBars;
      const history    = resources.history;
      const perspDepth = 0.9;

      // Sample frequency data, then apply a contrast expansion:
      // signals below the noise floor drop to zero, signals above are stretched
      // upward so loud peaks stand tall and quiet passages stay flat.
      // Apply a noise floor: signals below FLOOR map to zero, the remaining
      // range [FLOOR, 1] is stretched to [0, 1] without any additional gain.
      // This keeps quiet passages flat without amplifying loud ones into clipping.
      const FLOOR = 0.08;
      const levels = new Float32Array(numBars);
      for (let i = 0; i < numBars; i++) {
        const raw = getBarLevel(resources.bins, i, buf) / 255;
        levels[i] = Math.max(0, (raw - FLOOR) / (1 - FLOOR));
      }
      // Track smoothed energy for depth glow: fast rise, slow decay.
      let energySum = 0;
      for (let i = 0; i < numBars; i++) energySum += levels[i];
      const rawEnergy = energySum / numBars;
      resources.glowEnergy = rawEnergy > resources.glowEnergy
        ? resources.glowEnergy * 0.6 + rawEnergy * 0.4
        : resources.glowEnergy * 0.97 + rawEnergy * 0.03;
      const glow = resources.glowEnergy;

      history.unshift(levels);
      if (history.length > HISTORY) history.pop();

      // Very dark navy background — sets the deep-water atmosphere.
      ctx.fillStyle = '#000c18';
      ctx.fillRect(0, 0, W, H);

      // Depth glow: a bioluminescent bloom rising from deep below.
      const glowRadius = W * 0.55 + glow * W * 0.45;
      const glowAlpha  = 0.18 + glow * 0.50;
      const radGrad = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, glowRadius);
      radGrad.addColorStop(0,   'rgba(0,180,255,' + glowAlpha.toFixed(2) + ')');
      radGrad.addColorStop(0.4, 'rgba(0,90,180,'  + (glowAlpha * 0.5).toFixed(2) + ')');
      radGrad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = radGrad;
      ctx.fillRect(0, 0, W, H);

      // Draw from the oldest frame to the newest (painter's algorithm) so
      // recent frames always appear in front of older ones.
      for (let d = history.length - 1; d >= 0; d--) {
        const t     = d / HISTORY; // 0 = current (front), 1 = oldest (back)
        const frame = history[d];

        // Perspective: older frames shift upward and dim — full width is preserved
        // so every frequency bin remains visible at all depths.
        const yOff    = t * H * perspDepth * 0.48;
        const maxBarH = H;
        const stepW   = W / numBars;
        const bottomY = H - yOff;
        const peakY   = bottomY - maxBarH;
        const dim     = 1 - t * 0.85; // brightness falls off toward the back

        // Build the silhouette path for this depth layer.
        ctx.beginPath();
        ctx.moveTo(0, bottomY);
        for (let i = 0; i < numBars; i++) {
          ctx.lineTo(i * stepW, bottomY - frame[i] * maxBarH);
        }
        ctx.lineTo(W, bottomY);
        ctx.closePath();

        // Fill: fully transparent at the base, a subtle blue glow only in the
        // top quarter of the bar height. This keeps the lower area of the canvas
        // open so back layers remain clearly visible through the front ones.
        const fillGrad = ctx.createLinearGradient(0, bottomY, 0, peakY);
        fillGrad.addColorStop(0,    'rgba(0,0,0,0)');
        fillGrad.addColorStop(0.62, 'rgba(0,0,0,0)');
        fillGrad.addColorStop(0.84, 'rgba(0,'  + Math.round(90  * dim) + ',' + Math.round(200 * dim) + ',' + (0.22 * dim).toFixed(2) + ')');
        fillGrad.addColorStop(1,    'rgba('    + Math.round(60  * dim) + ',' + Math.round(180 * dim) + ',255,' + (0.50 * dim).toFixed(2) + ')');
        ctx.fillStyle = fillGrad;
        ctx.fill();

        // Stroke: vertical gradient from dark navy at the base to bright sky-blue
        // at the crest. Tall (loud) peaks are the most vivid; quiet areas stay deep.
        const strokeGrad = ctx.createLinearGradient(0, bottomY, 0, peakY);
        strokeGrad.addColorStop(0,   'rgba(0,'  + Math.round(40  * dim) + ',' + Math.round(130 * dim) + ',' + (0.40 * dim).toFixed(2) + ')');
        strokeGrad.addColorStop(0.5, 'rgba(0,'  + Math.round(160 * dim) + ',' + Math.round(240 * dim) + ',' + (0.85 * dim).toFixed(2) + ')');
        strokeGrad.addColorStop(1,   'rgba('    + Math.round(140 * dim) + ',' + Math.round(230 * dim) + ',255,' + Math.min(1, dim * 1.3).toFixed(2) + ')');
        ctx.strokeStyle = strokeGrad;
        // Current frame gets a slightly heavier line so it reads clearly as the front.
        ctx.lineWidth = d === 0 ? 1.5 : 0.8;
        ctx.stroke();
      }

      // Horizon mist: a veil of dark fog that thickens toward the back,
      // dissolving the oldest frames into haze.
      const mistGrad = ctx.createLinearGradient(0, 0, 0, H * 0.55);
      mistGrad.addColorStop(0,   'rgba(0,8,20,0.82)');
      mistGrad.addColorStop(0.5, 'rgba(0,8,20,0.35)');
      mistGrad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = mistGrad;
      ctx.fillRect(0, 0, W, H * 0.55);

      // Surface glints: bright motes spawned at the front wave's crests,
      // drifting sideways and upward like moonlight catching on ripples.
      const glints = resources.glints;
      const stepW  = W / numBars;
      if (history.length > 0) {
        const front = history[0];
        for (let i = 0; i < numBars; i++) {
          if (front[i] > 0.22 && Math.random() < 0.04) {
            glints.push({
              x:  Math.random() * W,
              y:  Math.random() * H * 0.82,
              vx: (Math.random() - 0.5) * 0.7,
              vy: -0.6 - Math.random() * 0.9,
              alpha: 0.7 + Math.random() * 0.3,
              r:  0.6 + Math.random() * 1.0,
            });
          }
        }
        if (glints.length > 200) glints.splice(0, glints.length - 200);
      }

      for (let gi = glints.length - 1; gi >= 0; gi--) {
        const g = glints[gi];
        g.x     += g.vx;
        g.y     += g.vy;
        g.alpha -= 0.018;
        if (g.alpha <= 0) { glints.splice(gi, 1); continue; }
        ctx.globalAlpha = g.alpha;
        ctx.fillStyle   = '#cceeff';
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    reset: function (resources) {
      resources.history    = [];
      resources.glowEnergy = 0;
      resources.glints     = [];
    },
  });

})();
