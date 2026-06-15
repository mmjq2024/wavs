// Classic Spectrum Analyzer — a Winamp-style frequency visualizer.
// Load one or more style files before this script, then drop this script into
// any page. Style files register themselves on window.SpectrumStyles and this
// engine picks them up automatically.
//
// Load order in HTML:
//   <script src="styles/bars.js"></script>
//   <script src="styles/waterfall.js"></script>
//   <script src="styles/sparkler.js"></script>
//   <script src="spectrum-analyzer.js"></script>
(function () {

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  // Canvas dimensions. Style files auto-fit their bar/element count to W.
  const W = 700;
  const H = 200;

  // ---------------------------------------------------------------------------
  // Song list
  // ---------------------------------------------------------------------------
  // Pre-defined tracks served from the site. Update the url values to match
  // wherever you host the audio files (relative or absolute paths both work).

  const SONGS = [
    { title: 'The Scientist',        artist: 'Coldplay',        url: 'audio/The Scientist - Coldplay.mp3' },
    { title: 'Show Me',              artist: 'Mint Royale',     url: 'audio/Show Me - Mint Royale.mp3' },
    { title: 'No Diggity (lofi)',    artist: 'Joongle',         url: 'audio/No Diggity lofi cover - Joongle.mp3' },
    { title: 'Baby Love Child',      artist: 'Pizzicato Five',  url: 'audio/Baby Love Child - Pizzicato Five.mp3' },
    { title: "L'Amour Toujours",     artist: "Gigi D'Agostino", url: "audio/Ill Fly Away With You (L' Amour Toujours) - Gigi D'Agostino.mp3" },
    { title: 'Time After Time',      artist: 'INOJ',            url: 'audio/Time After Time - INOJ.mp3' },
    { title: 'Starry Eyed Surprise', artist: 'Paul Oakenfold',  url: 'audio/Starry Eyed Surprise - Paul Oakenfold.mp3' },
    { title: 'The Freshmen',         artist: 'Verve Pipe',      url: 'audio/The Freshmen - Verve Pipe.mp3' },
    { title: 'Children',             artist: 'Robert Miles',    url: 'audio/Children - Robert Miles.mp3' },
  ];

  // ---------------------------------------------------------------------------
  // Style registry
  // ---------------------------------------------------------------------------
  // Style files push objects onto window.SpectrumStyles before this script runs.
  // Each style object must implement: settings, setup(), initBins(), render(), reset().

  const STYLES = window.SpectrumStyles || [];
  if (!STYLES.length) {
    console.error('Spectrum Analyzer: no styles loaded. Include a style file before spectrum-analyzer.js.');
    return;
  }

  let currentStyle = 0;
  let currentParams = {}; // current values of the active style's settings
  let styleResources = []; // one resource object per style, returned by setup()

  // ---------------------------------------------------------------------------
  // DOM — wrapper
  // ---------------------------------------------------------------------------

  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'width:700px',
    'background:#000',
    'margin: 20px auto 20px auto',
    'padding:8px',
    'border:1px solid #222',
  ].join(';');

  // ---------------------------------------------------------------------------
  // DOM — canvas
  // ---------------------------------------------------------------------------

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.style.alignSelf = 'center';
  wrap.appendChild(canvas);

  // ---------------------------------------------------------------------------
  // DOM — controls row: song selector | browse toggle | [file picker] | style selector | audio
  // ---------------------------------------------------------------------------

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:center;width:100%';

  const songSelect = document.createElement('select');
  songSelect.style.cssText = 'flex:1;background:#111;color:#00cc00;border:1px solid #333;font-size:11px;padding:2px 4px;cursor:pointer';
  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = '— select a song —';
  placeholderOpt.disabled = true;
  placeholderOpt.selected = true;
  songSelect.appendChild(placeholderOpt);
  SONGS.forEach(function (song, i) {
    const opt = document.createElement('option');
    opt.style.cssText = 'background:#111;color:#00cc00';
    opt.value = i;
    opt.textContent = song.title + ' — ' + song.artist;
    songSelect.appendChild(opt);
  });

  const browseBtn = document.createElement('button');
  browseBtn.textContent = 'Browse';
  browseBtn.style.cssText = 'background:#111;color:#00cc00;border:1px solid #333;font-size:11px;padding:2px 6px;cursor:pointer;white-space:nowrap';

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'audio/*';
  picker.style.cssText = 'flex:1;color:#00cc00;font-size:11px;background:transparent;border:none;cursor:pointer;display:none';

  const styleSelect = document.createElement('select');
  styleSelect.style.cssText = 'background:#111;color:#00cc00;border:1px solid #333;font-size:11px;padding:2px 4px;cursor:pointer';
  STYLES.forEach(function (style, i) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = style.name;
    opt.style.cssText = 'background:#111;color:#00cc00';
    styleSelect.appendChild(opt);
  });

  const audio = document.createElement('audio');
  audio.controls = true;
  audio.crossOrigin = 'anonymous'; // required for Web Audio API to analyse URL-based sources
  audio.style.cssText = 'flex:1;height:24px';

  row.appendChild(songSelect);
  row.appendChild(browseBtn);
  row.appendChild(picker);
  row.appendChild(styleSelect);
  row.appendChild(audio);
  wrap.appendChild(row);

  // ---------------------------------------------------------------------------
  // DOM — settings area
  // ---------------------------------------------------------------------------
  // Rebuilt each time the user switches styles. Each style declares its own
  // settings array; the engine renders the appropriate controls from it.

  const settingsWrap = document.createElement('div');
  settingsWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;width:100%';
  wrap.appendChild(settingsWrap);

  document.body.appendChild(wrap);

  // ---------------------------------------------------------------------------
  // Settings UI builder
  // ---------------------------------------------------------------------------

  // Tears down the previous style's settings controls and builds new ones from
  // style.settings. Resets currentParams to each setting's declared default.
  function buildSettingsUI(style) {
    while (settingsWrap.firstChild) settingsWrap.removeChild(settingsWrap.firstChild);
    currentParams = {};

    if (!style.settings || !style.settings.length) return;

    style.settings.forEach(function (setting) {
      currentParams[setting.id] = setting.default;

      if (setting.type === 'range') {
        const settingRow = document.createElement('div');
        settingRow.style.cssText = 'display:flex;gap:6px;align-items:center;width:100%';

        const label = document.createElement('span');
        label.textContent = setting.label + ':';
        label.style.cssText = 'color:#00cc00;font-size:10px;white-space:nowrap;font-family:monospace';

        const labelMin = document.createElement('span');
        labelMin.textContent = setting.labelMin || '';
        labelMin.style.cssText = 'color:#555;font-size:10px;font-family:monospace;white-space:nowrap';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = setting.min;
        slider.max = setting.max;
        slider.step = setting.step;
        slider.value = setting.default;
        slider.style.cssText = 'flex:1;cursor:pointer;accent-color:#00cc00';
        slider.addEventListener('input', function () {
          currentParams[setting.id] = parseFloat(slider.value);
        });

        const labelMax = document.createElement('span');
        labelMax.textContent = setting.labelMax || '';
        labelMax.style.cssText = 'color:#555;font-size:10px;font-family:monospace;white-space:nowrap';

        settingRow.appendChild(label);
        settingRow.appendChild(labelMin);
        settingRow.appendChild(slider);
        settingRow.appendChild(labelMax);
        settingsWrap.appendChild(settingRow);

      } else if (setting.type === 'toggle') {
        const settingRow = document.createElement('div');
        settingRow.style.cssText = 'display:flex;gap:6px;align-items:center';

        const btn = document.createElement('button');
        btn.style.cssText = 'background:#111;color:#00cc00;border:1px solid #333;font-size:11px;padding:2px 6px;cursor:pointer';
        function updateToggleLabel() {
          btn.textContent = setting.label + ': ' + (currentParams[setting.id] ? 'On' : 'Off');
        }
        updateToggleLabel();
        btn.addEventListener('click', function () {
          currentParams[setting.id] = !currentParams[setting.id];
          updateToggleLabel();
        });

        settingRow.appendChild(btn);
        settingsWrap.appendChild(settingRow);

      } else if (setting.type === 'select') {
        const settingRow = document.createElement('div');
        settingRow.style.cssText = 'display:flex;gap:6px;align-items:center';

        const label = document.createElement('span');
        label.textContent = setting.label + ':';
        label.style.cssText = 'color:#00cc00;font-size:10px;white-space:nowrap;font-family:monospace';

        const sel = document.createElement('select');
        sel.style.cssText = 'background:#111;color:#00cc00;border:1px solid #333;font-size:11px;padding:2px 4px;cursor:pointer';
        setting.options.forEach(function (opt) {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          if (opt === setting.default) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          currentParams[setting.id] = sel.value;
        });

        settingRow.appendChild(label);
        settingRow.appendChild(sel);
        settingsWrap.appendChild(settingRow);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Style initialisation
  // ---------------------------------------------------------------------------

  const ctx = canvas.getContext('2d');

  // Call each style's setup() immediately — this builds gradients and other
  // visual resources that don't depend on the AudioContext.
  styleResources = STYLES.map(function (style) {
    return style.setup(ctx, W, H);
  });

  // Build the settings UI for the initial style.
  buildSettingsUI(STYLES[currentStyle]);

  // ---------------------------------------------------------------------------
  // Audio setup
  // ---------------------------------------------------------------------------

  let audioCtx, analyser, source;
  let rafId = null;

  // Deferred until first user interaction so the AudioContext is created from
  // a user gesture, satisfying browser autoplay policy.
  // Graph: <audio> → MediaElementSourceNode → AnalyserNode → speakers.
  function init() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 32768; // max size — gives 16384 bins for fine low-freq resolution
    analyser.smoothingTimeConstant = 0.8;
    source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    // Give every style its bin mapping now that we know bufLen and sampleRate.
    STYLES.forEach(function (style, i) {
      style.initBins(styleResources[i], analyser.frequencyBinCount, audioCtx.sampleRate);
    });
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  function draw() {
    rafId = requestAnimationFrame(draw);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    // Delegate all drawing to the active style. The engine passes currentParams
    // so the style can read whatever settings it declared.
    STYLES[currentStyle].render(ctx, W, H, buf, styleResources[currentStyle], currentParams);
  }

  function stopDraw() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------

  // Toggle between the song list and the local file picker.
  browseBtn.addEventListener('click', function () {
    const browsing = picker.style.display === 'none';
    picker.style.display = browsing ? '' : 'none';
    songSelect.style.display = browsing ? 'none' : '';
    browseBtn.textContent = browsing ? 'Songs' : 'Browse';
  });

  songSelect.addEventListener('change', function () {
    const song = SONGS[parseInt(songSelect.value, 10)];
    if (!song) return;
    init();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    audio.src = song.url;
    audio.play().catch(function (err) { console.error('Playback failed:', err); });
  });

  styleSelect.addEventListener('change', function () {
    currentStyle = parseInt(styleSelect.value, 10);
    // Reset the incoming style's animation state (e.g. peak dots).
    var style = STYLES[currentStyle];
    if (style.reset) style.reset(styleResources[currentStyle]);
    // Rebuild the settings UI for the new style with its declared defaults.
    buildSettingsUI(style);
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
