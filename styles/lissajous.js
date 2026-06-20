// Lissajous visualization for the Classic Spectrum Analyzer.
// Five parametric Lissajous figures — one per frequency band — drawn with
// different harmonic ratios and sized by that band's FFT amplitude.
// A shared phase accumulator driven by overall energy animates all figures.
//
// Background: a static wireframe sphere pre-rendered to an offscreen canvas.
// Trail: a second offscreen canvas fades via destination-in so the sphere
// shows through the transparent gaps between Lissajous traces.
(function () {

  const THEMES = {
    'Hot Neon':   ['#ff00cc', '#ff6600', '#ffee00', '#00eeff', '#deccff'],
    'Crayola':    ['#ff2222', '#ff8800', '#ffee00', '#00ee44', '#4499ff'],
    'Fire':       ['#ff0000', '#ff4400', '#ff8800', '#ffcc00', '#ffffff'],
    'Ice':        ['#2081c3', '#63d2ff', '#78d5d7', '#bed8d4', '#f7f9f9'],
    'Miami':      ['#ffdfa9', '#ff8e72', '#ed6a5e', '#4ce0b3', '#ffffff'],
    '80s Neon':   ['#bfae48', '#d81e5b', '#23395b', '#12eaea', '#bce7fd'],
    'Bauhaus':    ['#999999', '#2986cc', '#ffd966', '#f44336', '#eeeeee'],
    'Sunny Day':  ['#ffffff', '#1e96fc', '#a2d6f9', '#fcf300', '#ffc600'],
  };

  // a:b harmonic ratios, one per band (sub-bass → highs).
  const RATIOS = [[1,1], [1,2], [2,3], [3,4], [3,5]];

  // Representative center frequency (Hz) for each of the 5 bands.
  const FREQ_CENTERS = [60, 130, 500, 3000, 10000];

  // Pre-render a wireframe sphere using an orthographic projection with a
  // slight elevation tilt so latitude lines appear as ellipses, not flat lines.
  function buildSphere(W, H) {
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const sc = canvas.getContext('2d');

    const cx   = W / 2;
    const cy   = H / 2;
    const R    = W * 1.4;   // very large — edges well off all sides
    const e    = 0.15;      // low elevation angle (~9°) keeps lines nearly flat
    const cose = Math.cos(e);
    const sine = Math.sin(e);

    sc.strokeStyle = 'rgba(255,255,255,0.18)';
    sc.lineWidth   = 0.8;

    const STEPS = 200;

    // Latitude arcs — back hemisphere only (λ from π/2 to 3π/2).
    // Projected point: x = R·cos(φ)·sin(λ), y = −R·sin(φ)·cos(e) + R·cos(φ)·cos(λ)·sin(e)
    const NUM_LAT = 60;
    for (let i = 0; i < NUM_LAT; i++) {
      const phi  = -Math.PI / 2 * 0.95 + (i / (NUM_LAT - 1)) * Math.PI * 0.95;
      const cosp = Math.cos(phi);
      const sinp = Math.sin(phi);
      sc.beginPath();
      for (let s = 0; s <= STEPS; s++) {
        const lambda = Math.PI / 2 + (s / STEPS) * Math.PI;
        const x = cx + R * cosp * Math.sin(lambda);
        const y = cy - R * sinp * cose + R * cosp * Math.cos(lambda) * sine;
        if (s === 0) sc.moveTo(x, y);
        else         sc.lineTo(x, y);
      }
      sc.stroke();
    }

    // Longitude meridians — back hemisphere only (λ from π/2 to 3π/2, φ from −π/2 to π/2).
    const NUM_LON = 28;
    for (let j = 0; j <= NUM_LON; j++) {
      const lambda = Math.PI / 2 + (j / NUM_LON) * Math.PI;
      const sinl   = Math.sin(lambda);
      const cosl   = Math.cos(lambda);
      sc.beginPath();
      for (let s = 0; s <= STEPS; s++) {
        const phi = -Math.PI / 2 + (s / STEPS) * Math.PI;
        const x = cx + R * Math.cos(phi) * sinl;
        const y = cy - R * Math.sin(phi) * cose + R * Math.cos(phi) * cosl * sine;
        if (s === 0) sc.moveTo(x, y);
        else         sc.lineTo(x, y);
      }
      sc.stroke();
    }

    return canvas;
  }

  (window.SpectrumStyles = window.SpectrumStyles || []).push({
    name: 'Lissajous',

    settings: [
      {
        id: 'size',
        type: 'range',
        label: 'Size',
        min: 1.0, max: 3.0, step: 0.1, default: 2.0,
        labelMin: 'small',
        labelMax: 'large',
      },
      {
        id: 'energy',
        type: 'range',
        label: 'Energy',
        min: 0.1, max: 2.0, step: 0.1, default: 0.6,
        labelMin: 'calm',
        labelMax: 'wild',
      },
      {
        type: 'group',
        settings: [
          { id: 'theme', type: 'select', label: 'Theme', options: Object.keys(THEMES), default: 'Hot Neon' },
          { id: 'trail', type: 'toggle', label: 'Trail', default: true },
          { id: 'glow',  type: 'toggle', label: 'Glow',  default: true },
        ],
      },
    ],

    setup: function (ctx, W, H) {
      const sphereCanvas = buildSphere(W, H);

      const trailCanvas = document.createElement('canvas');
      trailCanvas.width  = W;
      trailCanvas.height = H;
      const tc = trailCanvas.getContext('2d');

      return { phase: 0, amps: new Float32Array(5), sphereCanvas, trailCanvas, tc };
    },

    initBins: function (resources, bufLen, sampleRate) {
      const hzPerBin = sampleRate / (bufLen * 2);
      resources.bins = FREQ_CENTERS.map(function (freq) {
        return Math.min(Math.round(freq / hzPerBin), bufLen - 1);
      });
    },

    render: function (ctx, W, H, buf, resources, params, timeBuf) {
      const lw     = 1.0;
      const colors = THEMES[params.theme] || THEMES['Spectrum'];
      const tc     = resources.tc;

      // Smooth per-band amplitudes, then advance phase by overall energy
      const bins = resources.bins || [45, 97, 372, 2231, 7437];
      for (let b = 0; b < 5; b++) {
        resources.amps[b] = resources.amps[b] * 0.85 + (buf[bins[b]] / 255) * 0.15;
      }
      let energy = 0;
      for (let b = 0; b < 5; b++) energy += resources.amps[b];
      resources.phase += (energy / 5) * 0.15 * params.energy;

      const cx        = W / 2;
      const cy        = H / 2;
      const maxRadius = Math.min(W, H) / 2 * params.size;
      const phase     = resources.phase;
      const STEPS     = 600;

      // Fade trail to transparent (destination-in multiplies existing alpha).
      // This lets the sphere show through gaps rather than filling them black.
      tc.globalCompositeOperation = 'destination-in';
      tc.fillStyle = params.trail ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0)';
      tc.fillRect(0, 0, W, H);
      tc.globalCompositeOperation = 'source-over';

      // Draw Lissajous figures into the trail buffer
      for (let b = 4; b >= 0; b--) {
        const a      = RATIOS[b][0];
        const bv     = RATIOS[b][1];
        const radius = resources.amps[b] * maxRadius;
        if (radius < 1) continue;
        const hex = colors[b];

        function strokeFigure(context, lineWidth, alpha) {
          context.beginPath();
          context.lineWidth   = lineWidth;
          context.strokeStyle = hex;
          context.globalAlpha = alpha;
          for (let s = 0; s <= STEPS; s++) {
            const theta = (s / STEPS) * 2 * Math.PI;
            const x = cx + radius * Math.sin(a * theta + phase);
            const y = cy + radius * Math.sin(bv * theta);
            if (s === 0) context.moveTo(x, y);
            else         context.lineTo(x, y);
          }
          context.stroke();
          context.globalAlpha = 1;
        }

        if (params.glow) {
          strokeFigure(tc, lw * 6, 0.06);
          strokeFigure(tc, lw * 3, 0.13);
        }
        strokeFigure(tc, lw, 0.9);
      }

      // Composite: black base → static sphere → fading trail
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(resources.sphereCanvas, 0, 0);
      ctx.drawImage(resources.trailCanvas, 0, 0);
    },

    reset: function (resources) {
      resources.phase = 0;
      if (resources.amps) resources.amps.fill(0);
      if (resources.tc) {
        resources.tc.clearRect(0, 0, resources.trailCanvas.width, resources.trailCanvas.height);
      }
    },
  });

})();
