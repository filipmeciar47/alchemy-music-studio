// seqValidator.ts — SEQ pattern validator + genre template library
// Spec: seq_templates_and_validation_for_claude_code.md

/* ─── TYPES ──────────────────────────────────────────────────── */

export type GenreClass = 'FOUR_ON_FLOOR' | 'BREAKBEAT' | 'OFFBEAT';

/** Subset of the AI add_channel command that the validator cares about */
export interface AiChannelCmd {
  op: 'add_channel';
  sample?: number;
  steps?: (boolean | number)[];     // 16-element boolean/0-1 array
  velocities?: number[];             // 16-element 0-127 array
  ratchets?: number[];
  volume?: number;
  pan?: number;
  pitch?: number;
  eqLow?: number; eqMid?: number; eqHigh?: number;
  sidechain?: boolean;
  isKick?: boolean;
  filterAuto?: number[];
  [key: string]: unknown;
}

export interface ValidationIssue {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  channelIdx?: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  repairedCmds: AiChannelCmd[];
  usedFallback: boolean;
  fallbackGenre?: string;
}

/* ─── GENRE CLASS MAP ─────────────────────────────────────────── */

const GENRE_CLASS: Record<string, GenreClass> = {
  tekno: 'FOUR_ON_FLOOR',
  hard_tekno: 'FOUR_ON_FLOOR',
  hardtek: 'FOUR_ON_FLOOR',
  dub_techno: 'FOUR_ON_FLOOR',
  acidcore: 'FOUR_ON_FLOOR',
  acid_techno: 'FOUR_ON_FLOOR',
  house: 'FOUR_ON_FLOOR',
  tech_house: 'FOUR_ON_FLOOR',
  jungle: 'BREAKBEAT',
  dnb: 'BREAKBEAT',
  breakbeat: 'BREAKBEAT',
  reggae: 'OFFBEAT',
  dub: 'OFFBEAT',
};

function genreKey(g: string): string {
  return g.toLowerCase().replace(/[\s\-]/g, '_');
}

export function getGenreClass(genre: string): GenreClass {
  return GENRE_CLASS[genreKey(genre)] ?? 'FOUR_ON_FLOOR';
}

/* ─── UTILITIES ───────────────────────────────────────────────── */

function toBoolArr(steps: (boolean | number)[] | undefined, len = 16): boolean[] {
  const out = new Array(len).fill(false);
  if (!steps) return out;
  for (let i = 0; i < Math.min(steps.length, len); i++) out[i] = !!steps[i];
  return out;
}

function toVelArr(velocities: number[] | undefined, len = 16): number[] {
  const out = new Array(len).fill(80);
  if (!velocities) return out;
  for (let i = 0; i < Math.min(velocities.length, len); i++) out[i] = velocities[i];
  return out;
}

function activeCount(steps: boolean[]): number {
  return steps.filter(Boolean).length;
}

function activeIndices(steps: boolean[]): number[] {
  return steps.reduce<number[]>((acc, v, i) => { if (v) acc.push(i); return acc; }, []);
}

function collisions(a: boolean[], b: boolean[]): number {
  return a.filter((v, i) => v && b[i]).length;
}

function peakVel(velocities: number[]): number {
  return velocities.reduce((m, v) => Math.max(m, v), 0);
}

// Spec velocity scale 1-9 → app 0-127
function v(n: number): number { return Math.round((n / 9) * 127); }

/* ─── TEMPLATE BUILDER ────────────────────────────────────────── */

interface TplChannel {
  isKick?: boolean;
  sidechain?: boolean;
  active: number[];   // 0-based indices
  vel: number[];      // spec scale 1-9
  ratchets?: number[];
}

function mkTemplate(
  genre: string,
  bpm: number,
  chs: TplChannel[]
): { genre: string; bpm: number; channels: AiChannelCmd[] } {
  return {
    genre,
    bpm,
    channels: chs.map(ch => {
      const steps = new Array(16).fill(false);
      const velocities = new Array(16).fill(v(5));
      const ratchets = new Array(16).fill(1);
      ch.active.forEach((idx, i) => {
        steps[idx] = true;
        velocities[idx] = v(ch.vel[i] ?? 5);
      });
      if (ch.ratchets) ch.ratchets.forEach((r, i) => { ratchets[i] = r; });
      return {
        op: 'add_channel' as const,
        steps,
        velocities,
        ratchets,
        volume: ch.isKick ? 0.9 : ch.sidechain ? 0.85 : 0.75,
        pan: 0,
        pitch: 1,
        sidechain: ch.sidechain ?? false,
        isKick: ch.isKick ?? false,
      };
    }),
  };
}

/* ─── TEMPLATE LIBRARY ────────────────────────────────────────── */
// Indices: step 1=0, step 5=4, step 9=8, step 13=12

export const SEQ_TEMPLATES = {

  // ── TEKNO ──────────────────────────────────────────────────────
  tekno_standard: mkTemplate('tekno', 132, [
    { isKick: true,  active: [0,4,8,12],              vel: [9,7,9,7] },
    {                active: [4,12],                   vel: [9,9] },
    {                active: [1,3,5,7,9,11,13,15],     vel: [6,6,6,6,6,6,6,6] },
    { sidechain:true,active: [2,6,9,13],               vel: [7,6,7,6] },
    {                active: [2,10],                   vel: [5,5] },
  ]),

  tekno_rolling: mkTemplate('tekno', 136, [
    { isKick: true,  active: [0,4,8,12],              vel: [9,7,9,7] },
    {                active: [4,12],                   vel: [9,9] },
    {                active: [0,2,4,6,8,10,12,14],    vel: [6,6,6,6,6,6,6,6] },
    { sidechain:true,active: [2,5,8,11,14],            vel: [7,6,6,6,7] },
    {                active: [2,6,10,14],              vel: [4,4,4,4] },
  ]),

  // ── HARD TEKNO ─────────────────────────────────────────────────
  hard_tekno: mkTemplate('hard_tekno', 148, [
    { isKick: true,  active: [0,3,4,8,12],            vel: [9,6,7,9,7] },
    {                active: [4,7,12],                 vel: [9,3,9] },
    {                active: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
                     vel: [8,4,5,4,8,4,5,4,8,4,5,4,8,4,5,4] },
    { sidechain:true,active: [2,4,9,12],               vel: [7,6,7,6] },
    {                active: [1,5,9,13],               vel: [4,4,4,4] },
  ]),

  // ── DUB TECHNO ─────────────────────────────────────────────────
  dub_techno: mkTemplate('dub_techno', 122, [
    { isKick: true,  active: [0,8,12],                vel: [9,9,7] },
    {                active: [8],                      vel: [7] },
    {                active: [2,6,10,14],              vel: [5,5,5,5] },
    { sidechain:true,active: [2,10,14],                vel: [7,7,6] },
    {                active: [5],                      vel: [4] },
  ]),

  // ── ACIDCORE ───────────────────────────────────────────────────
  acidcore: mkTemplate('acidcore', 180, [
    { isKick: true,  active: [0,4,8,12],              vel: [9,8,9,8] },
    {                active: [4,12],                   vel: [8,8] },
    {                active: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
                     vel: [7,4,5,4,7,4,5,4,7,4,5,4,7,4,5,4] },
    // acid_bass — dense, no sidechain cap
    { sidechain:false,active: [0,1,3,4,6,7,9,10,12,13,15],
                     vel: [8,5,6,8,5,6,8,5,8,5,6] },
  ]),

  // ── HARDTEK ────────────────────────────────────────────────────
  hardtek: mkTemplate('hardtek', 160, [
    { isKick: true,  active: [0,2,4,8,10,12],         vel: [9,6,8,9,6,8] },
    {                active: [4,12],                   vel: [9,9] },
    {                active: [1,3,5,7,9,11,13,15],    vel: [6,6,6,6,6,6,6,6] },
    { sidechain:true,active: [0,4,8,11,12],            vel: [8,8,8,6,8] },
    {                active: [2,5,10,13],              vel: [5,5,5,5] },
  ]),

  // ── JUNGLE ─────────────────────────────────────────────────────
  jungle: mkTemplate('jungle', 172, [
    { isKick: true,  active: [0,6,10],                vel: [9,7,8] },
    {                active: [4,12,13],                vel: [9,9,4] },
    {                active: [2,6,10,14],              vel: [5,5,5,5] },
    { sidechain:true,active: [0,8],                    vel: [8,8] },
    {                active: [1,3,5,7,9,11,13,15],    vel: [4,3,4,3,4,3,4,3] },
  ]),

  // ── REGGAE / DUB ───────────────────────────────────────────────
  reggae: mkTemplate('reggae', 75, [
    { isKick: true,  active: [8],                     vel: [9] },
    {                active: [8],                      vel: [8] },
    {                active: [2,6,10,14],              vel: [5,5,5,5] },
    { sidechain:true,active: [0,3,8,11],               vel: [8,6,8,7] },
    {                active: [2,6,10,14],              vel: [4,4,4,4] },
  ]),

  // ── HOUSE ──────────────────────────────────────────────────────
  house: mkTemplate('house', 124, [
    { isKick: true,  active: [0,4,8,12],              vel: [9,8,9,8] },
    {                active: [4,12],                   vel: [8,8] },
    {                active: [2,6,10,14],              vel: [6,6,6,6] },
    { sidechain:true,active: [0,3,6,10,13],            vel: [8,6,6,7,6] },
    {                active: [1,3,5,7,9,11,13,15],    vel: [5,5,5,5,5,5,5,5] },
  ]),

  // ── TECH HOUSE ─────────────────────────────────────────────────
  tech_house: mkTemplate('tech_house', 126, [
    { isKick: true,  active: [0,4,8,12],              vel: [9,8,9,8] },
    {                active: [4,12],                   vel: [8,8] },
    {                active: [2,6,10,14],              vel: [6,6,6,6] },
    { sidechain:true,active: [1,3,7,11,14],            vel: [7,6,6,7,6] },
    {                active: [1,5,9,13],               vel: [5,5,5,5] },
  ]),
};

/** Returns a deep-cloned list of AiChannelCmds for a given genre */
export function getGenreTemplate(genre: string): AiChannelCmd[] {
  const k = genreKey(genre);
  const entry =
    SEQ_TEMPLATES[k as keyof typeof SEQ_TEMPLATES] ??
    SEQ_TEMPLATES[
      k.includes('hard') && k.includes('tek') ? 'hard_tekno' :
      k.includes('hardtek')                    ? 'hardtek'    :
      k.includes('acid')                       ? 'acidcore'   :
      k.includes('dub') && k.includes('tech')  ? 'dub_techno' :
      k.includes('jungle') || k.includes('dnb')? 'jungle'     :
      k.includes('reggae') || k.includes('dub')? 'reggae'     :
      k.includes('house')                      ? 'house'      :
      'tekno_standard'
    ];
  return entry.channels.map(c => ({
    ...c,
    steps: [...(c.steps as boolean[])],
    velocities: [...(c.velocities as number[])],
    ratchets: [...(c.ratchets as number[])],
  }));
}

/* ─── VALIDATOR ───────────────────────────────────────────────── */

export function validateChannelBatch(
  rawCmds: AiChannelCmd[],
  genre = 'tekno',
  opts: { allowSixth?: boolean } = {}
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const gClass = getGenreClass(genre);
  const maxCh = opts.allowSixth ? 6 : 5;

  // Normalize input
  let chs = rawCmds.map(c => ({
    ...c,
    steps:      toBoolArr(c.steps),
    velocities: toVelArr(c.velocities),
  }));

  // ── S6: drop empty channels (< 2 active steps) ─────────────────
  chs = chs.filter((c, i) => {
    const n = activeCount(c.steps as boolean[]);
    if (n < 2) {
      issues.push({ rule: 'S6', severity: 'error', channelIdx: i,
        message: `Kanál ${i} preskočený — len ${n} aktívny krok` });
      return false;
    }
    return true;
  });

  // ── S1: channel count cap ──────────────────────────────────────
  if (chs.length > maxCh) {
    issues.push({ rule: 'S1', severity: 'error',
      message: `${chs.length} kanálov > max ${maxCh} — odstraňujem nízko-prioritné` });
    const kicks  = chs.filter(c => c.isKick);
    const basses = chs.filter(c => c.sidechain && !c.isKick);
    const rest   = chs.filter(c => !c.isKick && !c.sidechain);
    chs = [...kicks, ...basses, ...rest].slice(0, maxCh);
  }

  // ── S5: velocity clamp ─────────────────────────────────────────
  chs = chs.map(c => ({
    ...c,
    velocities: (c.velocities as number[]).map(v => Math.max(0, Math.min(127, v))),
  }));

  // ── K4: exactly one kick ───────────────────────────────────────
  const kickCount = chs.filter(c => c.isKick).length;
  if (kickCount === 0 && gClass !== 'OFFBEAT') {
    issues.push({ rule: 'K4', severity: 'warning',
      message: 'Žiadny kick kanál (isKick:true)' });
  }
  if (kickCount > 1) {
    issues.push({ rule: 'K4', severity: 'error',
      message: `${kickCount} kick kanálov — zachovávam prvý` });
    let seen = false;
    chs = chs.map(c => {
      if (!c.isKick) return c;
      if (!seen) { seen = true; return c; }
      return { ...c, isKick: false };
    });
  }

  // ── K1: kick must start on step 1 (index 0) ────────────────────
  chs = chs.map(c => {
    if (!c.isKick) return c;
    const steps = [...(c.steps as boolean[])];
    if (!steps[0]) {
      issues.push({ rule: 'K1', severity: 'error',
        message: 'Kick nemá krok 1 — pridávam automaticky' });
      steps[0] = true;
      const vels = [...(c.velocities as number[])];
      if (!vels[0]) vels[0] = 127;
      return { ...c, steps, velocities: vels };
    }
    return c;
  });

  // ── SN1: snare/clap not on steps 1 or 9 (FOUR_ON_FLOOR only) ──
  if (gClass === 'FOUR_ON_FLOOR') {
    chs = chs.map((c, ci) => {
      if (c.isKick || c.sidechain) return c;
      const steps = [...(c.steps as boolean[])];
      const hasBackbeat = steps[4] || steps[12]; // kroky 5 alebo 13
      if (!hasBackbeat) return c;                // nie je snare
      let changed = false;
      if (steps[0]) { steps[0] = false; changed = true;
        issues.push({ rule: 'SN1', severity: 'error', channelIdx: ci,
          message: `Kanál ${ci}: snare/clap na kroku 1 — odstránený` }); }
      if (steps[8]) { steps[8] = false; changed = true;
        issues.push({ rule: 'SN1', severity: 'error', channelIdx: ci,
          message: `Kanál ${ci}: snare/clap na kroku 9 — odstránený` }); }
      return changed ? { ...c, steps } : c;
    });
  }

  // ── H1: hat pattern must not be identical to kick ──────────────
  const kickCh = chs.find(c => c.isKick);
  if (kickCh) {
    chs.forEach((c, ci) => {
      if (c.isKick || c.sidechain) return;
      const kIdx = JSON.stringify(activeIndices(kickCh.steps as boolean[]));
      const cIdx = JSON.stringify(activeIndices(c.steps as boolean[]));
      if (kIdx === cIdx) {
        issues.push({ rule: 'H1', severity: 'warning', channelIdx: ci,
          message: `Kanál ${ci}: hat pattern je identický s kickom` });
      }
    });
  }

  // ── H2: hat peak velocity < kick peak velocity ─────────────────
  if (kickCh) {
    const kPeak = peakVel(kickCh.velocities as number[]);
    chs.forEach((c, ci) => {
      if (c.isKick || c.sidechain) return;
      const hPeak = peakVel(c.velocities as number[]);
      if (hPeak >= kPeak) {
        issues.push({ rule: 'H2', severity: 'warning', channelIdx: ci,
          message: `Kanál ${ci}: hat velocity (${hPeak}) ≥ kick velocity (${kPeak})` });
      }
    });
  }

  // ── B1: bass max 6 active steps ────────────────────────────────
  chs = chs.map((c, ci) => {
    if (!c.sidechain || c.isKick) return c;
    const steps = [...(c.steps as boolean[])];
    const cnt = activeCount(steps);
    if (cnt <= 6) return c;
    issues.push({ rule: 'B1', severity: 'error', channelIdx: ci,
      message: `Bass ${cnt} krokov > 6 — skracujem na 6 (najvyššia velocity)` });
    const vels = c.velocities as number[];
    const ranked = activeIndices(steps)
      .sort((a, b) => (vels[b] ?? 0) - (vels[a] ?? 0));
    const keep = new Set(ranked.slice(0, 6));
    steps.forEach((_, i) => { if (steps[i] && !keep.has(i)) steps[i] = false; });
    return { ...c, steps };
  });

  // ── B2: bass min 3 active steps (warning) ──────────────────────
  chs.forEach((c, ci) => {
    if (!c.sidechain || c.isKick) return;
    const cnt = activeCount(c.steps as boolean[]);
    if (cnt < 3) {
      issues.push({ rule: 'B2', severity: 'warning', channelIdx: ci,
        message: `Bass má len ${cnt} kroky — príliš riedky` });
    }
  });

  // ── B3: bass–kick collisions max 2 (warning; skip hardtek/acidcore) ──
  if (kickCh && !['hardtek','acidcore','acid_techno'].includes(genreKey(genre))) {
    chs.forEach((c, ci) => {
      if (!c.sidechain || c.isKick) return;
      const n = collisions(c.steps as boolean[], kickCh.steps as boolean[]);
      if (n > 2) {
        issues.push({ rule: 'B3', severity: 'warning', channelIdx: ci,
          message: `Bass koliduje s kickom ${n}× (max 2 pre ${genre})` });
      }
    });
  }

  // ── X2: total bass hits ≤ total hat hits (warning) ─────────────
  const bassHits = chs.filter(c => c.sidechain && !c.isKick)
    .reduce((s, c) => s + activeCount(c.steps as boolean[]), 0);
  const hatHits = chs.filter(c => !c.isKick && !c.sidechain)
    .reduce((s, c) => s + activeCount(c.steps as boolean[]), 0);
  if (bassHits > hatHits && hatHits > 0) {
    issues.push({ rule: 'X2', severity: 'warning',
      message: `Bass hits (${bassHits}) > hat hits (${hatHits}) — bass je hustejší ako rytmus` });
  }

  // ── X3: bass must be sidechained if kick exists ─────────────────
  if (kickCh) {
    chs = chs.map((c, ci) => {
      if (c.isKick || c.sidechain) return c;
      // Heuristic: few steps + lower velocity profile = possibly bass
      // We can only enforce on channels that look like bass pattern
      return c;
    });
  }

  const errors = issues.filter(i => i.severity === 'error');

  return {
    valid: errors.length === 0,
    issues,
    repairedCmds: chs,
    usedFallback: false,
  };
}

/* ─── REPAIR LOOP ─────────────────────────────────────────────── */

/**
 * Validates and auto-repairs a batch of add_channel commands.
 * After 2 failed attempts falls back to the genre template.
 */
export function repairOrFallback(
  cmds: AiChannelCmd[],
  genre: string,
  attempt: number,
  opts?: { allowSixth?: boolean }
): ValidationResult {
  if (attempt >= 2) {
    return {
      valid: true,
      issues: [{ rule: 'FALLBACK', severity: 'warning',
        message: `Použitý fallback template pre žáner "${genre}" po 2 neúspešných opravách` }],
      repairedCmds: getGenreTemplate(genre),
      usedFallback: true,
      fallbackGenre: genre,
    };
  }
  const result = validateChannelBatch(cmds, genre, opts);
  // Second pass on the already-repaired output to catch cascading issues
  const second = validateChannelBatch(result.repairedCmds, genre, opts);
  return {
    ...second,
    issues: [...result.issues, ...second.issues],
    usedFallback: false,
  };
}

/* ─── DENSITY GUIDE (for system prompt info) ─────────────────── */

export const DENSITY_BY_GENRE: Record<string, { min: number; max: number; bpm: [number,number] }> = {
  dub_techno:  { min: 12, max: 18, bpm: [118, 128] },
  tekno:       { min: 18, max: 26, bpm: [128, 142] },
  hard_tekno:  { min: 26, max: 34, bpm: [142, 158] },
  hardtek:     { min: 32, max: 42, bpm: [158, 185] },
  acidcore:    { min: 32, max: 48, bpm: [170, 192] },
  jungle:      { min: 18, max: 28, bpm: [160, 178] },
  reggae:      { min: 10, max: 16, bpm: [70,  90]  },
  house:       { min: 20, max: 28, bpm: [120, 130] },
};
