import { GoogleGenerativeAI, Part } from "@google/generative-ai";

const MODEL = "gemini-2.0-flash";
const INLINE_SIZE_LIMIT = 18 * 1024 * 1024; // 18 MB — stay under 20 MB limit

function client(): GoogleGenerativeAI {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

export interface SmartPreviewResult {
  quality_ok: boolean;
  quality_reason?: string;
  genre: string;
  bpm: number | null;
  key: string | null;
  structure: Array<{ section: string; start: string; end: string }>;
  summary: string;
  complexity: "low" | "medium" | "high";
  notable_elements: string[];
}

export interface StemAnalysis {
  stem_file: string;
  layer_name: string;
  instruments: string[];
  description: string;
  function: string;
  confidence: number;
  effects_detected: string[];
  timestamps: Array<{ time: string; event: string }>;
  suggested_processing: string;
}

export interface ZoomVerification {
  target_stem: string;
  confidence: number;
  purity: number;
  identification: string;
  improvement_suggestion?: string;
}

// ---- Smart Preview (raw mix, quality gate + orientation) ----
export async function smartPreview(
  audioBuffer: Buffer,
  mimeType: string,
): Promise<SmartPreviewResult> {
  const gen = client();
  const model = gen.getGenerativeModel({ model: MODEL });

  const audioPart = toAudioPart(audioBuffer, mimeType);

  const prompt = `Listen to this audio recording and provide a quick assessment.
Respond ONLY with valid JSON, no markdown, no explanation outside the JSON.

{
  "quality_ok": boolean (is this sufficient quality for stem separation?),
  "quality_reason": string or null (if quality_ok is false, explain why),
  "genre": string (specific genre, e.g. "dub techno" not just "electronic"),
  "bpm": number or null,
  "key": string or null (e.g. "A minor", "F# major"),
  "structure": [{"section": string, "start": "m:ss", "end": "m:ss"}],
  "summary": string (2-3 sentences about character and notable elements),
  "complexity": "low" | "medium" | "high",
  "notable_elements": string[] (distinctive sounds/instruments you hear)
}`;

  const result = await model.generateContent([audioPart, prompt]);
  return parseJson<SmartPreviewResult>(result.response.text());
}

// ---- Deep stem analysis (receives separated stems after Demucs) ----
export async function analyzeStems(
  stems: Array<{ name: string; buffer: Buffer; mimeType: string }>,
  context: { genre: string; bpm: number | null; key: string | null },
): Promise<StemAnalysis[]> {
  const gen = client();
  const model = gen.getGenerativeModel({ model: MODEL });

  const parts: Part[] = [];

  for (const stem of stems) {
    parts.push({ text: `--- Stem file: ${stem.name} ---` });
    parts.push(toAudioPart(stem.buffer, stem.mimeType));
  }

  const prompt = `You are an expert music analyst. You received ${stems.length} separated audio stems from a single track.
Genre context: ${context.genre}. BPM: ${context.bpm ?? "unknown"}. Key: ${context.key ?? "unknown"}.

Analyze what you HEAR in each stem. Do NOT guess from filenames.
For genre-specific elements use precise names:
- reggae/dub: skank, one-drop, dub delay, spring reverb, dub siren
- techno: rumble kick, acid line, industrial percussion, pad wash
- acidcore/hardtek: distorted kick, hoover synth, amen break
- dub techno: chord wash, hiss, tape delay, deep reverb

Respond ONLY with a valid JSON array (one object per stem, in same order as provided):
[{
  "stem_file": string (filename),
  "layer_name": string (musically meaningful name),
  "instruments": string[],
  "description": string,
  "function": string (role in the track),
  "confidence": number (0.0–1.0),
  "effects_detected": string[],
  "timestamps": [{"time": "m:ss", "event": string}],
  "suggested_processing": string
}]`;

  parts.push({ text: prompt });

  // If batch is too large for one request, analyse stems individually and merge
  const totalSize = stems.reduce((s, st) => s + st.buffer.length, 0);
  if (totalSize > INLINE_SIZE_LIMIT * 3) {
    return analyzeStepsIndividually(stems, context);
  }

  const result = await model.generateContent(parts);
  return parseJson<StemAnalysis[]>(result.response.text());
}

async function analyzeStepsIndividually(
  stems: Array<{ name: string; buffer: Buffer; mimeType: string }>,
  context: { genre: string; bpm: number | null; key: string | null },
): Promise<StemAnalysis[]> {
  const results: StemAnalysis[] = [];
  for (const stem of stems) {
    const [single] = await analyzeStems([stem], context);
    results.push(single);
  }
  return results;
}

// ---- Deep Zoom verification ----
export async function verifyZoomExtraction(
  stems: Array<{ name: string; buffer: Buffer; mimeType: string }>,
  targetInstrument: string,
  fragmentRange: { start: string; end: string },
): Promise<ZoomVerification> {
  const gen = client();
  const model = gen.getGenerativeModel({ model: MODEL });

  const parts: Part[] = [];
  for (const stem of stems) {
    parts.push({ text: `--- Stem: ${stem.name} ---` });
    parts.push(toAudioPart(stem.buffer, stem.mimeType));
  }

  const prompt = `Surgical audio analysis. Target: "${targetInstrument}". Fragment: ${fragmentRange.start}–${fragmentRange.end}.

Listen to each stem. Identify which contains the target.

Respond ONLY with valid JSON:
{
  "target_stem": string (filename of best match),
  "confidence": number (0.0–1.0, certainty this is the target),
  "purity": number (0.0–1.0, how clean is extraction, 1.0=pure),
  "identification": string (detailed technical description of what you hear),
  "improvement_suggestion": string or null (if confidence < 0.8, what might help)
}`;

  parts.push({ text: prompt });

  const result = await model.generateContent(parts);
  return parseJson<ZoomVerification>(result.response.text());
}

// ---- Helpers ----
function toAudioPart(buffer: Buffer, mimeType: string): Part {
  return {
    inlineData: {
      mimeType: mimeType as any,
      data: buffer.toString("base64"),
    },
  };
}

function parseJson<T>(text: string): T {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return JSON.parse(cleaned) as T;
}
