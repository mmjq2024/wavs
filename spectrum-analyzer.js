// Classic Spectrum Analyzer — a Winamp-style frequency visualizer.
// Drop this script into any page; it appends a self-contained widget to <body>.
// Users pick a local audio file, choose a visual style, and optionally blend
// between two gradient fill modes using the slider.
(function () {

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  // Canvas dimensions. Each style auto-fits its bar count to W based on its
  // barWidth and barGap, so changing W here is all that's needed to resize.
  const W = 700;
  const H = 200;

  // Peak dot behaviour: dots hold at their highest position for PEAK_HOLD_FRAMES
  // frames before falling at PEAK_DECAY pixels per frame.
  const PEAK_HOLD_FRAMES = 30;
  const PEAK_DECAY = 0.5;

  // Frequency range mapped across the bars. 20 Hz–20 kHz covers human hearing.
  const MIN_FREQ = 20;
  const MAX_FREQ = 20000;

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  // Each style controls bar geometry, gradient colours, and peak dot appearance.
  // Adding a new style is just adding an object here — numBars is computed
  // automatically from barWidth, barGap, and W.
  //
  // stops: gradient colour stops as [position (0–1), colour] pairs.
  //        position 0 = top of bar (loudest), position 1 = bottom of bar.

  const STYLES = [
    {
      name: 'Classic',
      barWidth: 3, barGap: 1, showPeaks: true,
      stops: [[0, '#ff0000'], [0.5, '#ffff00'], [1, '#00ff00']],
      peakColor: '#ffffff',
    },
    {
      name: 'Monochrome',
      barWidth: 3, barGap: 1, showPeaks: true,
      stops: [[0, '#ffffff'], [1, '#444444']],
      peakColor: '#00ff88',
    },
    {
      name: 'Mountain',
      // Narrower bars with no gap create a dense, continuous mountain silhouette.
      barWidth: 2, barGap: 0, showPeaks: false,
      stops: [
        [0,    '#ffffff'],
        [0.2,  '#ff88ff'],
        [0.45, '#4488ff'],
        [0.7,  '#00ffcc'],
        [1,    '#006644'],
      ],
      peakColor: null,
    },
  ];

  // Compute how many bars fit in W for each style.
  STYLES.forEach(function (style) {
    style.numBars = Math.floor((W + style.barGap) / (style.barWidth + style.barGap));
  });

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let currentStyle = 0;

  // gradientBlend controls how the gradient is sampled for each bar:
  //   0 = positional — the gradient spans the full canvas height, so a bar's
  //       colour depends on how tall it is relative to the canvas (short bars
  //       show only the bottom colours).
  //   1 = per-bar — the full gradient is stretched to fit each bar's height,
  //       so every bar shows all colours regardless of how short it is.
  // Values in between give a smooth blend of both behaviours.
  let gradientBlend = 1;

  // One offscreen 1×H canvas per style, used to sample gradient colours via
  // drawImage. Built once at startup; see buildOffscreenGradients().
  let offscreenGradients = [];

  // One Int32Array per style mapping bar indices to FFT bin ranges.
  // Populated in computeAllBarBins() after the AudioContext is created,
  // because bin count depends on the device's sample rate.
  let allBarBins = null;

  // Peak dot state — sized to the largest bar count across all styles.
  const maxBars = Math.max.apply(null, STYLES.map(function (s) { return s.numBars; }));
  const peaks = new Array(maxBars).fill(0);        // current peak height in pixels
  const holdCounters = new Array(maxBars).fill(0); // frames remaining in hold phase

  let audioCtx, analyser, source;
  let rafId = null; // requestAnimationFrame handle; null when not animating

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'display:inline-flex',
    'flex-direction:column',
    'align-items:stretch',
    'gap:6px',
    'background:#000',
    'padding:8px',
    'border:1px solid #222',
  ].join(';');

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.style.alignSelf = 'center';
  wrap.appendChild(canvas);

  // Controls row: file picker | style selector | audio player
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:center;width:100%';

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'audio/*';
  picker.style.cssText = 'flex:1;color:#00cc00;font-size:11px;background:transparent;border:none;cursor:pointer';

  const styleSelect = document.createElement('select');
  styleSelect.style.cssText = 'background:#111;color:#00cc00;border:1px solid #333;font-size:11px;padding:2px 4px;cursor:pointer';
  STYLES.forEach(function (style, i) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = style.name;
    styleSelect.appendChild(opt);
  });

  const audio = document.createElement('audio');
  audio.controls = true;
  audio.style.cssText = 'flex:1;height:24px';

  row.appendChild(picker);
  row.appendChild(styleSelect);
  row.appendChild(audio);
  wrap.appendChild(row);

  // Gradient blend row: label | "Positional" | slider | "Per-bar"
  const blendRow = document.createElement('div');
  blendRow.style.cssText = 'display:flex;gap:6px;align-items:center;width:100%';

  const blendLabel = document.createElement('span');
  blendLabel.style.cssText = 'color:#00cc00;font-size:10px;white-space:nowrap;font-family:monospace';
  blendLabel.textContent = 'Gradient:';

  const blendMin = document.createElement('span');
  blendMin.style.cssText = 'color:#555;font-size:10px;font-family:monospace';
  blendMin.textContent = 'Positional';

  const blendSlider = document.createElement('input');
  blendSlider.type = 'range';
  blendSlider.min = 0;
  blendSlider.max = 1;
  blendSlider.step = 0.01;
  blendSlider.value = 1;
  blendSlider.style.cssText = 'flex:1;cursor:pointer;accent-color:#00cc00';

  const blendMax = document.createElement('span');
  blendMax.style.cssText = 'color:#555;font-size:10px;font-family:monospace';
  blendMax.textContent = 'Per-bar';

  blendRow.appendChild(blendLabel);
  blendRow.appendChild(blendMin);
  blendRow.appendChild(blendSlider);
  blendRow.appendChild(blendMax);
  wrap.appendChild(blendRow);

  document.body.appendChild(wrap);

  // ---------------------------------------------------------------------------
  // Gradient setup
  // ---------------------------------------------------------------------------

  const ctx = canvas.getContext('2d');

  // Each style gets a 1×H offscreen canvas with its gradient baked in as pixels.
  // During drawing, drawImage stretches a slice of this canvas onto each bar,
  // which lets us blend between positional and per-bar gradient modes without
  // creating new gradient objects every frame.
  function buildOffscreenGradients() {
    offscreenGradients = STYLES.map(function (style) {
      const off = document.createElement('canvas');
      off.width = 1;
      off.height = H;
      const offCtx = off.getContext('2d');
      const g = offCtx.createLinearGradient(0, 0, 0, H);
      style.stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
      offCtx.fillStyle = g;
      offCtx.fillRect(0, 0, 1, H);
      return off;
    });
  }
  buildOffscreenGradients();

  // ---------------------------------------------------------------------------
  // FFT bin mapping
  // ---------------------------------------------------------------------------

  // Maps each bar index to a range of FFT bins using a logarithmic frequency
  // scale, so octaves are evenly spaced across the bar array. The +1 extra
  // entry stores the upper boundary of the last bar.
  //
  // Called once after the AudioContext is created, because frequencyBinCount
  // and sampleRate depend on the browser / audio device.
  function computeAllBarBins(bufLen, sampleRate) {
    const nyquist = sampleRate / 2;
    const logMin = Math.log(MIN_FREQ);
    const logRange = Math.log(MAX_FREQ / MIN_FREQ);
    allBarBins = STYLES.map(function (style) {
      const n = style.numBars;
      const bins = new Int32Array(n + 1);
      for (let i = 0; i <= n; i++) {
        bins[i] = Math.min(
          Math.floor(Math.exp(logMin + logRange * i / n) / nyquist * bufLen),
          bufLen - 1
        );
      }
      return bins;
    });
  }

  // Returns the average magnitude across all FFT bins that fall within bar i's
  // frequency range. Averaging prevents aliasing at high frequencies where a
  // single bar can span many bins.
  function getBarLevel(styleIndex, i, buf) {
    const bins = allBarBins[styleIndex];
    const start = bins[i];
    const end = Math.max(start, bins[i + 1] - 1);
    let sum = 0;
    for (let b = start; b <= end; b++) sum += buf[b];
    return sum / (end - start + 1);
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  function draw() {
    rafId = requestAnimationFrame(draw);

    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf); // fills buf with 0–255 magnitude per bin

    const si = currentStyle;
    const style = STYLES[si];
    const bw = style.barWidth;
    const bg = style.barGap;
    const n = style.numBars;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < n; i++) {
      const barH = Math.round((getBarLevel(si, i, buf) / 255) * H);
      const x = i * (bw + bg);

      if (barH > 0) {
        // Blend between two gradient sampling modes by interpolating the source
        // rectangle within the offscreen gradient canvas:
        //   gradientBlend = 0 (positional): sample the slice that aligns with
        //     the bar's position on the canvas — tall bars show more colours.
        //   gradientBlend = 1 (per-bar): sample the full gradient, stretching
        //     it to fit the bar — every bar shows all colours.
        const srcY = (H - barH) * (1 - gradientBlend);
        const srcH = barH + (H - barH) * gradientBlend;
        ctx.drawImage(offscreenGradients[si], 0, srcY, 1, srcH, x, H - barH, bw, barH);
      }

      if (style.showPeaks) {
        // Advance peak dot state: snap up instantly, hold, then fall.
        if (barH >= peaks[i]) {
          peaks[i] = barH;
          holdCounters[i] = PEAK_HOLD_FRAMES;
        } else if (holdCounters[i] > 0) {
          holdCounters[i]--;
        } else {
          peaks[i] = Math.max(0, peaks[i] - PEAK_DECAY);
        }

        if (peaks[i] > 0) {
          ctx.fillStyle = style.peakColor;
          ctx.fillRect(x, H - Math.round(peaks[i]), bw, 1);
        }
      }
    }
  }

  function stopDraw() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Audio setup
  // ---------------------------------------------------------------------------

  // Initialises the Web Audio API graph on first file pick (deferred so the
  // AudioContext is created from a user gesture, satisfying autoplay policy).
  // Graph: <audio> element → MediaElementSourceNode → AnalyserNode → speakers.
  function init() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 32768; // max size — gives 16384 bins for fine low-freq resolution
    analyser.smoothingTimeConstant = 0.8; // temporal smoothing between frames (0–1)
    source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    computeAllBarBins(analyser.frequencyBinCount, audioCtx.sampleRate);
  }

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------

  blendSlider.addEventListener('input', function () {
    gradientBlend = parseFloat(blendSlider.value);
  });

  styleSelect.addEventListener('change', function () {
    currentStyle = parseInt(styleSelect.value, 10);
    // Clear peak state so dots from the previous style don't linger.
    peaks.fill(0);
    holdCounters.fill(0);
  });

  picker.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    init();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    // createObjectURL gives a local blob URL — no CORS restrictions.
    audio.src = URL.createObjectURL(file);
    audio.play();
  });

  audio.addEventListener('play', function () {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (rafId === null) draw();
  });

  audio.addEventListener('pause', stopDraw);
  audio.addEventListener('ended', stopDraw);

})();
