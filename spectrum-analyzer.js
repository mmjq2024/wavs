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
  const H = 300;

  // ---------------------------------------------------------------------------
  // Song list
  // ---------------------------------------------------------------------------
  // Pre-defined tracks served from the site. Update the url values to match
  // wherever you host the audio files (relative or absolute paths both work).

  const SONGS = [
    { title: 'Baby Love Child',      artist: 'Pizzicato Five',       url: '/wavs/audio/Baby Love Child - Pizzicato Five.mp3' },
    { title: 'No Diggity',           artist: 'Blackstreet',          url: '/wavs/audio/Blackstreet - No Diggity.mp3' },
    { title: 'Crossroad',            artist: 'Bone Thugs N Harmony', url: '/wavs/audio/Bone Thugs N Harmony - Crossroad.mp3' },
    { title: 'Children',             artist: 'Robert Miles',         url: '/wavs/audio/Children - Robert Miles.mp3' },
    { title: 'Between The Bars',     artist: 'Elliott Smith',        url: '/wavs/audio/Elliott Smith - Between The Bars.mp3' },
    { title: 'Everything',           artist: 'Hooch',                url: '/wavs/audio/Everything - Hooch.mp3' },
    { title: "L'Amour Toujours",     artist: "Gigi D'Agostino",      url: "/wavs/audio/Ill Fly Away With You (L' Amour Toujours) - Gigi D'Agostino.mp3" },
    { title: 'One Million Miles Away', artist: 'J Ralph',            url: '/wavs/audio/J Ralph - One Million Miles Away.mp3' },
    { title: 'Aisha',                artist: 'Khaled',               url: '/wavs/audio/Khaled - Aisha.mp3' },
    { title: 'Walking in Memphis',   artist: 'Marc Cohn',            url: '/wavs/audio/Marc Cohn - Walking In Memphis.mp3' },
    { title: 'Baro',                 artist: 'Nil Lara',             url: '/wavs/audio/Nil Lara - Baro.m4a' },
    { title: 'Paranoid Android',     artist: 'Radiohead',            url: '/wavs/audio/Radiohead - Paranoid Android.mp3' },
    { title: 'Closing Time',         artist: 'Semisonic',            url: '/wavs/audio/Semisonic - Closing Time.mp3' },
    { title: 'Show Me',              artist: 'Mint Royale',          url: '/wavs/audio/Show Me - Mint Royale.mp3' },
    { title: 'Tonight Tonight',      artist: 'Smashing Pumpkins',    url: '/wavs/audio/Smashing Pumpkins - Tonight Tonight.mp3' },
    { title: 'Main Title',           artist: 'Sneakers',             url: '/wavs/audio/Sneakers - Main Title.flac' },
    { title: 'Starry Eyed Surprise', artist: 'Paul Oakenfold',       url: '/wavs/audio/Starry Eyed Surprise - Paul Oakenfold.mp3' },
    { title: 'The Freshmen',         artist: 'Verve Pipe',           url: '/wavs/audio/The Freshmen - Verve Pipe.mp3' },
    { title: 'Time After Time',      artist: 'INOJ',                 url: '/wavs/audio/Time After Time - INOJ.mp3' },
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
    'display:flex',
    'flex-direction:column',
    'align-items:stretch',
    'gap:6px',
    'box-sizing:border-box',
    'width:716px',
    'background:#000',
    'padding:8px',
    'border:1px solid #222',
    'margin:20px auto',
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
  row.style.cssText = 'display:flex;gap:8px;align-items:center;width:100%;flex-wrap:wrap';

  const songSelect = document.createElement('select');
  songSelect.style.cssText = 'flex:1;background:#111;color:#00cc00;border:1px solid #333;font-size:14px;padding:6px 8px;cursor:pointer';
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
  browseBtn.style.cssText = 'background:#111;color:#00cc00;border:1px solid #333;font-size:14px;padding:6px 12px;cursor:pointer;white-space:nowrap';

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'audio/*';
  picker.style.cssText = 'flex:1;color:#00cc00;font-size:14px;background:transparent;border:none;cursor:pointer;display:none';

  const styleSelect = document.createElement('select');
  styleSelect.style.cssText = 'background:#111;color:#00cc00;border:1px solid #333;font-size:14px;padding:6px 8px;cursor:pointer';
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
  settingsWrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;width:100%';
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

    // Returns a self-contained DOM element for one setting (no outer row wrapper).
    function buildControl(setting) {
      currentParams[setting.id] = setting.default;

      if (setting.type === 'range') {
        const settingRow = document.createElement('div');
        settingRow.style.cssText = 'display:flex;gap:6px;align-items:center;width:100%';

        const label = document.createElement('span');
        label.textContent = setting.label + ':';
        label.style.cssText = 'color:#00cc00;font-size:13px;white-space:nowrap;font-family:monospace';

        const labelMin = document.createElement('span');
        labelMin.textContent = setting.labelMin || '';
        labelMin.style.cssText = 'color:#555;font-size:12px;font-family:monospace;white-space:nowrap';

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
        labelMax.style.cssText = 'color:#555;font-size:12px;font-family:monospace;white-space:nowrap';

        settingRow.appendChild(label);
        settingRow.appendChild(labelMin);
        settingRow.appendChild(slider);
        settingRow.appendChild(labelMax);
        return settingRow;

      } else if (setting.type === 'toggle') {
        const btn = document.createElement('button');
        btn.style.cssText = 'background:#111;color:#00cc00;border:1px solid #333;font-size:14px;padding:6px 12px;cursor:pointer';
        function updateToggleLabel() {
          btn.textContent = setting.label + ': ' + (currentParams[setting.id] ? 'On' : 'Off');
        }
        updateToggleLabel();
        btn.addEventListener('click', function () {
          currentParams[setting.id] = !currentParams[setting.id];
          updateToggleLabel();
        });
        return btn;

      } else if (setting.type === 'select') {
        const settingRow = document.createElement('div');
        settingRow.style.cssText = 'display:flex;gap:6px;align-items:center';

        const label = document.createElement('span');
        label.textContent = setting.label + ':';
        label.style.cssText = 'color:#00cc00;font-size:13px;white-space:nowrap;font-family:monospace';

        const sel = document.createElement('select');
        sel.style.cssText = 'background:#111;color:#00cc00;border:1px solid #333;font-size:14px;padding:6px 8px;cursor:pointer';
        setting.options.forEach(function (opt) {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          o.style.cssText = 'background:#111;color:#00cc00';
          if (opt === setting.default) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          currentParams[setting.id] = sel.value;
        });

        settingRow.appendChild(label);
        settingRow.appendChild(sel);
        return settingRow;
      }
    }

    style.settings.forEach(function (setting) {
      if (setting.type === 'group') {
        const groupRow = document.createElement('div');
        const justify  = setting.justify || 'space-between';
        groupRow.style.cssText = 'display:flex;gap:16px;align-items:center;justify-content:' + justify + ';width:100%';
        setting.settings.forEach(function (child) {
          groupRow.appendChild(buildControl(child));
        });
        settingsWrap.appendChild(groupRow);
      } else {
        settingsWrap.appendChild(buildControl(setting));
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
    analyser.smoothingTimeConstant = 0.65;
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
    const timeBuf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(timeBuf);
    // Delegate all drawing to the active style. The engine passes currentParams
    // so the style can read whatever settings it declared.
    // timeBuf (7th arg) is optional — frequency-only styles ignore it.
    STYLES[currentStyle].render(ctx, W, H, buf, styleResources[currentStyle], currentParams, timeBuf);
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
