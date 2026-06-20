(function () {

  const BARS      = 200;    // angular samples per cloud (one per 1.8°)
  const STAR_R    = 5;
  const MIN_RFRAC = 0.18;   // resting radius when frequency is silent (prevents flower shape)

  // Five frequency bands drawn back-to-front (highs first, sub-bass last/on top).
  // maxRFrac mirrors real X-ray remnant structure: hot inner gas (blue/green) stays
  // compact while the cooler outer shell (yellow/orange/red) expands furthest.
  const BANDS = [
    { freqMin: 9000, freqMax: 20000, r: 50,  g: 75,  b: 155, gain: 3.0, phaseDeg:   0, maxRFrac: 0.28 }, // blue  — innermost
    { freqMin: 3000, freqMax: 9000,  r: 35,  g: 115, b: 60,  gain: 2.0, phaseDeg:  72, maxRFrac: 0.36 }, // green
    { freqMin: 800,  freqMax: 3000,  r: 145, g: 125, b: 30,  gain: 1.4, phaseDeg: 144, maxRFrac: 0.64 }, // yellow
    { freqMin: 200,  freqMax: 800,   r: 155, g: 75,  b: 30,  gain: 1.0, phaseDeg: 216, maxRFrac: 0.74 }, // orange
    { freqMin: 20,   freqMax: 200,   r: 140, g: 40,  b: 45,  gain: 0.7, phaseDeg: 288, maxRFrac: 0.83 }, // red   — outermost
  ];

  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------------------
  // Starfield background
  // ---------------------------------------------------------------------------

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
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Style registration
  // ---------------------------------------------------------------------------

  (window.SpectrumStyles = window.SpectrumStyles || []).push({
    name: 'Supernova',

    settings: [],

    setup: function (ctx, W, H) {
      // Fixed per-vertex noise per band — creates stable structural knots like
      // a real remnant rather than jittering every frame.
      var noiseGrid = BANDS.map(function () {
        var n = new Float32Array(BARS);
        for (var i = 0; i < BARS; i++) n[i] = 0.80 + Math.random() * 0.40;
        return n;
      });
      return {
        bg:         starfieldSetup(W, H),
        sectorBins: null,
        ejections:  [],
        noiseGrid:  noiseGrid,
        rotation:   0,
      };
    },

    initBins: function (resources, bufLen, sampleRate) {
      var nyquist = sampleRate / 2;
      resources.sectorBins = BANDS.map(function (band) {
        var bins = [];
        for (var i = 0; i < BARS; i++) {
          var t    = i / (BARS - 1);
          var freq = band.freqMin * Math.pow(band.freqMax / band.freqMin, t);
          bins.push(Math.min(Math.floor(freq / nyquist * bufLen), bufLen - 1));
        }
        return bins;
      });
    },

    render: function (ctx, W, H, buf, resources, params) {
      starfieldDraw(ctx, W, H, resources.bg);

      if (!resources.sectorBins) return;

      var cx   = W / 2;
      var cy   = H / 2;
      var halfMin = Math.min(W, H);

      // Rotate the entire cloud + ejection layer slowly around the centre.
      // The starfield is drawn before this and stays fixed.
      resources.rotation -= 0.0015;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(resources.rotation);
      ctx.translate(-cx, -cy);

      ctx.globalCompositeOperation = 'screen';

      for (var bi = 0; bi < BANDS.length; bi++) {
        var band     = BANDS[bi];
        var bins     = resources.sectorBins[bi];
        var noise    = resources.noiseGrid[bi];
        var phaseRad = band.phaseDeg * Math.PI / 180;
        var cr = band.r, cg = band.g, cb = band.b;
        var maxR     = halfMin * band.maxRFrac;

        // Diffuse outer halo — the faint emission beyond the shock front seen
        // in real X-ray remnant images.
        var haloR = maxR * 1.2;
        var halo  = ctx.createRadialGradient(cx, cy, maxR * 0.1, cx, cy, haloR);
        halo.addColorStop(0,    'rgba(' + cr + ',' + cg + ',' + cb + ',0)');
        halo.addColorStop(0.55, 'rgba(' + cr + ',' + cg + ',' + cb + ',0.10)');
        halo.addColorStop(1,    'rgba(' + cr + ',' + cg + ',' + cb + ',0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, haloR, 0, TAU);
        ctx.fill();

        // Build polygon — 200 vertices give filamentary edge detail.
        // Per-vertex noise modulates the amplitude-driven radius to create
        // stable structural knots like those seen in real supernova remnants.
        ctx.beginPath();
        for (var i = 0; i <= BARS; i++) {
          var angle = (i / BARS) * TAU - Math.PI / 2 + phaseRad;
          var idx   = i % BARS;

          var raw = (buf[bins[(idx + BARS - 1) % BARS]] +
                     buf[bins[idx]] +
                     buf[bins[(idx + 1) % BARS]]) / (3 * 255);
          var level  = Math.min(1, raw * band.gain);
          // Noise only scales the amplitude-driven part so the MIN_RFRAC base
          // stays smooth and the knotty texture appears only where signal exists.
          var r      = (MIN_RFRAC + level * (1 - MIN_RFRAC) * noise[idx]) * maxR;

          var x = cx + Math.cos(angle) * r;
          var y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else         ctx.lineTo(x, y);
        }
        ctx.closePath();

        // Very faint interior fill — most brightness lives in the rim strokes.
        ctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',0.07)';
        ctx.fill();

        ctx.lineJoin = 'round';

        // Outermost bloom — very wide, barely visible, feathers the edge smoothly.
        ctx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',0.08)';
        ctx.lineWidth   = 40;
        ctx.stroke();

        // Broad soft stroke — the main glow body of the shock front.
        ctx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',0.25)';
        ctx.lineWidth   = 14;
        ctx.stroke();

        // Narrow bright stroke — the concentrated emission filament at the rim.
        ctx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',0.70)';
        ctx.lineWidth   = 1;
        ctx.stroke();
      }

      // Spawn ejections — wisps that break off and drift outward.
      // Spawn chance scales with band energy so loud moments throw off more wisps.
      var ejs = resources.ejections;
      for (var bi = 0; bi < BANDS.length; bi++) {
        var band     = BANDS[bi];
        var sbins    = resources.sectorBins[bi];
        var energy   = Math.min(1, (buf[sbins[0]] + buf[sbins[BARS >> 1]] + buf[sbins[BARS - 1]]) / (3 * 255) * band.gain);
        if (ejs.length < 600 && Math.random() < energy * 0.08) {
          var phaseRad  = band.phaseDeg * Math.PI / 180;
          var bandMaxR  = halfMin * band.maxRFrac;
          ejs.push({
            angle: phaseRad + (Math.random() - 0.5) * Math.PI,
            dist:  bandMaxR * (MIN_RFRAC + Math.random() * 0.35),
            vd:    1.0 + Math.random() * 1.8,
            va:    (Math.random() - 0.5) * 0.01,
            size:  0.8 + Math.random() * 0.5,
            alpha: 0.5 + Math.random() * 0.4,
            decay: 0.0015 + Math.random() * 0.001,
            cr: band.r, cg: band.g, cb: band.b,
          });
        }
      }

      // Draw and age ejections under screen blending to match the cloud glow.
      for (var ei = ejs.length - 1; ei >= 0; ei--) {
        var e = ejs[ei];
        e.dist  += e.vd;
        e.angle += e.va;
        e.alpha -= e.decay;
        if (e.alpha <= 0) { ejs.splice(ei, 1); continue; }
        var ex = cx + Math.cos(e.angle) * e.dist;
        var ey = cy + Math.sin(e.angle) * e.dist;
        var ca = e.alpha.toFixed(2);
        var gr = ctx.createRadialGradient(ex, ey, 0, ex, ey, e.size * 3);
        gr.addColorStop(0, 'rgba(' + e.cr + ',' + e.cg + ',' + e.cb + ',' + ca + ')');
        gr.addColorStop(1, 'rgba(' + e.cr + ',' + e.cg + ',' + e.cb + ',0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(ex, ey, e.size * 3, 0, TAU);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.restore(); // undo rotation — star is the axis and must stay centred

      // Glowing centre star drawn last so it always sits on top.
      var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, STAR_R * 6);
      glow.addColorStop(0,    'rgba(255,255,255,1)');
      glow.addColorStop(0.35, 'rgba(255,255,255,0.6)');
      glow.addColorStop(1,    'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, STAR_R * 6, 0, TAU);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, STAR_R, 0, TAU);
      ctx.fill();
    },

    reset: function (resources) {
      resources.bg.t      = 0;
      resources.ejections = [];
      resources.rotation  = 0;
    },
  });

})();
