// Self-contained audio analysis (no external deps) for the Music Studio.
// Computes duration/peak/rms + BPM (onset-envelope autocorrelation),
// onsets (spectral flux), loudness (RMS/peak dB, approx LUFS, crest factor)
// and musical key (chroma + Krumhansl-Kessler key profiles).
// Kept dependency-free so it transfers to the parallel fork as a pure copy.

export type AnalysisInfo = {
  duration: number;
  sr: number;
  ch: number;
  peak: number;
  rms: number;
  bpm: number | null;
  // loudness
  peakDb: number;
  rmsDb: number;
  lufs: number;
  crest: number;
  // rhythm
  onsetCount: number;
  onsets: number[]; // seconds, first few
  // tonal
  key: string | null; // e.g. "A"
  scale: "major" | "minor" | null;
  keyStr: number; // 0..1 confidence
};

const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const fin = (n: number, fb = 0) => (Number.isFinite(n) ? n : fb);
const db = (x: number) => (Number.isFinite(x) && x > 1e-7 ? 20 * Math.log10(x) : -120);

// Cache by buffer identity: edits create NEW AudioBuffers, so this only avoids
// re-analyzing the SAME buffer (e.g. repeated UI reads of cur.buffer / original).
const _cache = new WeakMap<AudioBuffer, AnalysisInfo>();

function emptyInfo(buf: AudioBuffer): AnalysisInfo {
  return {
    duration: fin(buf.duration, 0), sr: fin(buf.sampleRate, 0), ch: buf.numberOfChannels || 1,
    peak: 0, rms: 0, bpm: null, peakDb: -120, rmsDb: -120, lufs: -70, crest: 0,
    onsetCount: 0, onsets: [], key: null, scale: null, keyStr: 0,
  };
}

// Iterative radix-2 FFT (in-place). re/im length must be a power of 2.
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + (len >> 1)], bi = im[i + k + (len >> 1)];
        const tr = br * cr - bi * ci, ti = br * ci + bi * cr;
        re[i + k] = ar + tr; im[i + k] = ai + ti;
        re[i + k + (len >> 1)] = ar - tr; im[i + k + (len >> 1)] = ai - ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

function pearson(a: number[], b: number[]) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; dbb += xb * xb;
  }
  const den = Math.sqrt(da * dbb);
  return den > 0 ? num / den : 0;
}

export function analyze(buf: AudioBuffer): AnalysisInfo {
  const cached = _cache.get(buf);
  if (cached) return cached;
  const sr = buf.sampleRate;
  if (!(sr > 0) || buf.length === 0) { const e = emptyInfo(buf); _cache.set(buf, e); return e; }
  const full = buf.getChannelData(0);
  // cap analysis window to first 12s for bounded cost
  const N = Math.min(full.length, Math.floor(sr * 12));

  // --- peak / rms (skip non-finite input samples) ---
  let peak = 0, sq = 0, cnt = 0;
  for (let i = 0; i < N; i++) {
    const v = full[i];
    if (!Number.isFinite(v)) continue;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sq += v * v; cnt++;
  }
  const rms = cnt > 0 ? Math.sqrt(sq / cnt) : 0;
  const peakDb = db(peak);
  const rmsDb = db(rms);
  const crest = fin(peakDb - rmsDb, 0);

  // --- approx integrated LUFS (gated 400ms blocks, BS.1770-ish without K-weighting) ---
  const blk = Math.floor(sr * 0.4), hop = Math.floor(sr * 0.1);
  const blkL: number[] = [];
  if (blk > 0 && hop > 0) {
    for (let s = 0; s + blk <= N; s += hop) {
      let ms = 0;
      for (let i = 0; i < blk; i++) { const v = full[s + i]; ms += v * v; }
      ms /= blk;
      blkL.push(-0.691 + 10 * Math.log10(Math.max(ms, 1e-10)));
    }
  }
  let lufs = -70;
  if (blkL.length) {
    const gated = blkL.filter((l) => l > -70);
    const src = gated.length ? gated : blkL;
    let e = 0;
    for (const l of src) e += Math.pow(10, l / 10);
    lufs = fin(10 * Math.log10(e / src.length), -70);
  }

  // --- STFT for spectral flux (onsets/BPM) + chroma (key) ---
  const FRAME = 1024, HOP = 512;
  const win = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const half = FRAME >> 1;
  const chroma = new Array(12).fill(0);
  const flux: number[] = [];
  let prevMag = new Float32Array(half);
  const re = new Float32Array(FRAME), im = new Float32Array(FRAME);

  for (let s = 0; s + FRAME <= N; s += HOP) {
    for (let i = 0; i < FRAME; i++) { re[i] = full[s + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let fsum = 0;
    const mag = new Float32Array(half);
    for (let k = 1; k < half; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      mag[k] = m;
      const d = m - prevMag[k];
      if (d > 0) fsum += d;
      const f = (k * sr) / FRAME;
      if (f >= 55 && f <= 5000 && m > 0) {
        const pc = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
        chroma[pc] += m;
      }
    }
    flux.push(fsum);
    prevMag = mag;
  }
  const fps = sr / HOP;

  // --- onsets: adaptive peak-pick on flux ---
  const onsets: number[] = [];
  if (flux.length > 3) {
    let mean = 0;
    for (const f of flux) mean += f;
    mean /= flux.length;
    let varr = 0;
    for (const f of flux) varr += (f - mean) * (f - mean);
    const std = Math.sqrt(varr / flux.length);
    const thr = mean + 0.6 * std;
    let last = -1e9;
    const minGap = fps * 0.05;
    for (let i = 1; i < flux.length - 1; i++) {
      if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1] && i - last > minGap) {
        onsets.push(fin(i / fps, 0));
        last = i;
      }
    }
  }

  // --- BPM via autocorrelation of the flux (onset) envelope ---
  let bpm: number | null = null;
  if (flux.length > 8) {
    let m = 0;
    for (const f of flux) m += f;
    m /= flux.length;
    const env = flux.map((f) => f - m);
    const minLag = Math.max(1, Math.floor((fps * 60) / 200));
    const maxLag = Math.min(env.length - 1, Math.ceil((fps * 60) / 60));
    let best = -Infinity, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let ac = 0;
      for (let i = lag; i < env.length; i++) ac += env[i] * env[i - lag];
      if (ac > best) { best = ac; bestLag = lag; }
    }
    if (bestLag > 0) {
      let b = (fps * 60) / bestLag;
      if (Number.isFinite(b) && b > 0) {
        let g = 0;
        while (b < 70 && g++ < 16) b *= 2;
        g = 0;
        while (b > 200 && g++ < 16) b /= 2;
        bpm = Math.round(fin(b, 0)) || null;
      }
    }
  }

  // --- key: correlate chroma with KK profiles over 12 rotations ---
  let key: string | null = null;
  let scale: "major" | "minor" | null = null;
  let keyStr = 0;
  const csum = chroma.reduce((a, b) => a + b, 0);
  if (csum > 0) {
    const c = chroma.map((x) => x / csum);
    for (let r = 0; r < 12; r++) {
      const maj: number[] = [], min: number[] = [];
      for (let i = 0; i < 12; i++) { maj.push(KK_MAJ[(i + r) % 12]); min.push(KK_MIN[(i + r) % 12]); }
      const cm = pearson(c, maj);
      const cn = pearson(c, min);
      if (cm > keyStr) { keyStr = cm; key = PC[r]; scale = "major"; }
      if (cn > keyStr) { keyStr = cn; key = PC[r]; scale = "minor"; }
    }
  }

  const result: AnalysisInfo = {
    duration: fin(buf.duration, 0),
    sr: fin(sr, 0),
    ch: buf.numberOfChannels || 1,
    peak: fin(peak, 0),
    rms: fin(rms, 0),
    bpm,
    peakDb: fin(peakDb, -120),
    rmsDb: fin(rmsDb, -120),
    lufs: fin(lufs, -70),
    crest: fin(crest, 0),
    onsetCount: onsets.length,
    onsets: onsets.slice(0, 8),
    key,
    scale,
    keyStr: fin(keyStr, 0),
  };
  _cache.set(buf, result);
  return result;
}
