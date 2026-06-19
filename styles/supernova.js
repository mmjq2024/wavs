(function () {

  const BARS      = 90;     // angular samples per cloud (one per 4°)
  const STAR_R    = 5;
  const MAX_RFRAC = 0.75;   // max cloud radius as fraction of min(W,H)/2
  const MIN_RFRAC = 0.18;   // resting radius when frequency is silent (prevents flower shape)

  // Five frequency bands — each becomes one full 360° cloud.
  // All drawn around the same centre; their shapes differ because they each
  // sample a different slice of the spectrum. Draw order: highs underneath,
  // sub-bass on top, so the band with the most energy peeks through.
  // phaseDeg staggers each cloud's frequency-to-angle mapping by 72° so the
  // same note lands at a different angle in each cloud, giving each band a
  // unique shape and preventing them from all bulging in the same direction.
  const BANDS = [
    { freqMin: 9000, freqMax: 20000, r: 80,  g: 130, b: 255, gain: 3.0, phaseDeg:   0 }, // blue
    { freqMin: 3000, freqMax: 9000,  r: 60,  g: 200, b: 60,  gain: 2.0, phaseDeg:  72 }, // green
    { freqMin: 800,  freqMax: 3000,  r: 230, g: 210, b: 0,   gain: 1.4, phaseDeg: 144 }, // yellow
    { freqMin: 200,  freqMax: 800,   r: 255, g: 140, b: 0,   gain: 1.0, phaseDeg: 216 }, // orange
    { freqMin: 20,   freqMax: 200,   r: 255, g: 55,  b: 55,  gain: 0.7, phaseDeg: 288 }, // red (front)
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
      return {
        bg:         starfieldSetup(W, H),
        sectorBins: null,
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
      var maxR = Math.min(W, H) * MAX_RFRAC;

      ctx.globalCompositeOperation = 'screen';

      for (var bi = 0; bi < BANDS.length; bi++) {
        var band      = BANDS[bi];
        var bins      = resources.sectorBins[bi];
        var phaseRad  = band.phaseDeg * Math.PI / 180;

        // Build the cloud outline. Each angular sample becomes a polygon vertex
        // whose distance from the centre is set by that frequency's amplitude.
        // Averaging 3 neighbouring bins smooths out sharp spikes in the shape.
        // phaseDeg rotates the mapping so each band's shape is offset by 72°,
        // preventing all clouds from bulging in the same direction simultaneously.
        ctx.beginPath();
        for (var i = 0; i <= BARS; i++) {
          var angle = (i / BARS) * TAU - Math.PI / 2 + phaseRad;
          var idx   = i % BARS;

          var raw = (buf[bins[(idx + BARS - 1) % BARS]] +
                     buf[bins[idx]] +
                     buf[bins[(idx + 1) % BARS]]) / (3 * 255);
          var level = Math.min(1, raw * band.gain);
          var r     = (MIN_RFRAC + level * (1 - MIN_RFRAC)) * maxR;

          var x = cx + Math.cos(angle) * r;
          var y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else         ctx.lineTo(x, y);
        }
        ctx.closePath();

        ctx.fillStyle = 'rgba(' + band.r + ',' + band.g + ',' + band.b + ',0.16)';
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';

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
      resources.bg.t = 0;
    },
  });

})();
