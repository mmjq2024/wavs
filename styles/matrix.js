// The Matrix — dense columns of always-present green characters.
// Each column's cascade head jumps to the peak amplitude position and
// falls slowly as the signal drops, leaving a fading glow trail above.
(function () {

  const FONT_SIZE  = 10;
  const CHARS = 'ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';
  const MIN_FREQ   = 20;
  const MAX_FREQ   = 20000;
  const AMBIENT    = 35;   // dim green all characters always show
  const GLOW_MAX   = 220;  // extra brightness injected at the cascade head
  const GLOW_DECAY = 0.96; // per-frame trail fade (lower = shorter trail)
  const FALL_SPEED = 0.25; // rows/frame the head descends when amplitude drops

  // Ambient rain — independent of audio. Occasional drops spawn at the top of
  // a random column and fall at their own pace, just like the classic effect.
  const AMBIENT_SPAWN_CHANCE = 0.008; // per column, per frame
  const AMBIENT_GLOW         = 170;    // dimmer than a music-driven head
  const AMBIENT_SPEED_MIN    = 0.15;
  const AMBIENT_SPEED_RANGE  = 0.35;

  function randomChar() {
    return CHARS[Math.random() * CHARS.length | 0];
  }

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

  (window.SpectrumStyles = window.SpectrumStyles || []).push({
    name: 'The Matrix',

    settings: [],

    setup: function (ctx, W, H) {
      const numCols = Math.floor(W / FONT_SIZE);
      const numRows = Math.floor(H / FONT_SIZE);

      const chars = [];
      const glow  = [];
      for (let c = 0; c < numCols; c++) {
        const col = [];
        for (let r = 0; r < numRows; r++) col.push(randomChar());
        chars.push(col);
        glow.push(new Float32Array(numRows));
      }

      // Cascade head per column (fractional row). numRows = off-canvas / inactive.
      const heads = new Float32Array(numCols).fill(numRows);

      // Ambient rain drops: independent per-column position + per-drop speed.
      const ambientHeads  = new Float32Array(numCols).fill(numRows);
      const ambientSpeeds = new Float32Array(numCols);

      return { numCols, numRows, chars, glow, heads, ambientHeads, ambientSpeeds, bins: null, charTimer: 0 };
    },

    initBins: function (resources, bufLen, sampleRate) {
      resources.bins = computeBins(resources.numCols, bufLen, sampleRate);
    },

    render: function (ctx, W, H, buf, resources, params) {
      const { numCols, numRows, chars, glow, heads, ambientHeads, ambientSpeeds, bins } = resources;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.font = FONT_SIZE + 'px monospace';
      ctx.textBaseline = 'top';

      // Flicker one random character per column every few frames.
      resources.charTimer++;
      if (resources.charTimer % 3 === 0) {
        for (let c = 0; c < numCols; c++) {
          chars[c][Math.random() * numRows | 0] = randomChar();
        }
      }

      for (let c = 0; c < numCols; c++) {
        // Visual EQ: c=0 (bass) gets 0.5× gain, c=numCols (treble) gets 3×,
        // so the spectrum looks balanced despite music's natural bass dominance.
        const rawAmp = bins ? getBarLevel(bins, c, buf) / 255 : 0;
        const eq     = 0.4 + 2.0 * Math.pow(c / numCols, 1.2);
        const amp    = Math.min(1, rawAmp * eq);

        // Loud = head near top (row 0); quiet = head near bottom.
        const targetRow = Math.floor((1 - amp) * numRows);

        if (amp > 0.02) {
          // Snap up to new peak immediately; fall slowly when amplitude drops.
          heads[c] = targetRow < heads[c] ? targetRow : Math.min(heads[c] + FALL_SPEED, numRows);
        } else {
          heads[c] = Math.min(heads[c] + FALL_SPEED, numRows); // drain off-canvas in silence
        }

        // Inject glow at the head position.
        const headRow = heads[c] | 0;
        if (headRow < numRows) glow[c][headRow] = GLOW_MAX;

        // Ambient rain: spawns and falls on its own schedule, unrelated to amp.
        if (ambientHeads[c] >= numRows) {
          if (Math.random() < AMBIENT_SPAWN_CHANCE) {
            ambientHeads[c]  = 0;
            ambientSpeeds[c] = AMBIENT_SPEED_MIN + Math.random() * AMBIENT_SPEED_RANGE;
          }
        } else {
          const ambientRow = ambientHeads[c] | 0;
          glow[c][ambientRow] = Math.max(glow[c][ambientRow], AMBIENT_GLOW);
          ambientHeads[c] += ambientSpeeds[c];
        }
        const ambientRow = ambientHeads[c] | 0;

        // Draw every cell: decay glow then render character.
        for (let r = 0; r < numRows; r++) {
          glow[c][r] *= GLOW_DECAY;
          const brightness = Math.min(255, AMBIENT + Math.round(glow[c][r]));
          if (r === headRow && headRow < numRows) {
            ctx.fillStyle = '#ccffcc'; // music-driven head: white-hot
          } else if (r === ambientRow && ambientHeads[c] < numRows) {
            ctx.fillStyle = '#88ee88'; // ambient drop head: bright green, not white
          } else {
            ctx.fillStyle = `rgb(0,${brightness},0)`;
          }
          ctx.fillText(chars[c][r], c * FONT_SIZE, r * FONT_SIZE);
        }
      }
    },

    reset: function (resources) {
      resources.heads.fill(resources.numRows);
      resources.ambientHeads.fill(resources.numRows);
      for (let c = 0; c < resources.numCols; c++) resources.glow[c].fill(0);
    },
  });

})();
