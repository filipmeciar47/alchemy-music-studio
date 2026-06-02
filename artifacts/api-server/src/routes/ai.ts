import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

const MODEL = "gpt-4o";

// ---- Single source of truth for the operations the AI can emit ----
const OP_ENUM = [
  "select", "trim_silence", "crop_time", "split", "merge", "loop", "effects",
  "rename", "duplicate", "create_from", "add_channel", "set_channel",
  "shift_channel", "set_bpm", "set_swing", "set_pattern", "copy_pattern",
  "bounce_pattern", "export", "export_pattern",
  "clear_channel", "remove_channel", "duplicate_channel", "euclid", "humanize", "apply_genre",
  "add_to_track", "auto_mix", "match_reference",
  "add_sample_to_track", "save_to_library",
];

const GENRES = ["tekno", "hardtek", "acidcore"];

const operationsTool = {
  type: "function" as const,
  function: {
    name: "execute_audio_operations",
    description:
      "Return a short chat message (Slovak) and an ordered list of audio operations to run in the music studio. ALWAYS call this function. If no action is needed, return operations: [].",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Short reply to the user in Slovak (max 2 sentences).",
        },
        operations: {
          type: "array",
          description: "Ordered list of audio operations to execute.",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: OP_ENUM },
              sample: { type: "number", description: "Sample index." },
              source: { type: "number", description: "Source sample index (create_from)." },
              channel: { type: "number", description: "Channel index (set_channel/shift_channel)." },
              start: { type: "number" },
              end: { type: "number" },
              time: { type: "number", description: "Split point in seconds." },
              times: { type: "number", description: "Loop repetitions." },
              crossfade: { type: "number" },
              samples: { type: "array", items: { type: "number" }, description: "Sample indices to merge." },
              gaps: { type: "array", items: { type: "number" } },
              name: { type: "string" },
              newName: { type: "string" },
              steps: { type: "array", items: { type: "number" }, description: "Step sequence of 0/1." },
              velocities: { type: "array", items: { type: "number" } },
              ratchets: { type: "array", items: { type: "number" } },
              volume: { type: "number", description: "0..2, 1=unity." },
              pan: { type: "number", description: "-1..1." },
              pitch: { type: "number", description: "0.1..4, 1=normal." },
              eqLow: { type: "number", description: "0..3, 1=neutral." },
              eqMid: { type: "number", description: "0..3, 1=neutral." },
              eqHigh: { type: "number", description: "0..3, 1=neutral." },
              mute: { type: "boolean" },
              solo: { type: "boolean" },
              sidechain: { type: "boolean" },
              isKick: { type: "boolean" },
              bpm: { type: "number", description: "20..400." },
              swing: { type: "number", description: "50..75." },
              pattern: { type: "number", description: "0..7." },
              from: { type: "number" },
              to: { type: "number" },
              pulses: { type: "number", description: "Euclidean pulses/hits for op=euclid." },
              rotate: { type: "number", description: "Euclidean rotation offset for op=euclid." },
              amount: { type: "number", description: "0..1 strength for op=humanize." },
              genre: { type: "string", enum: GENRES, description: "Genre profile for op=apply_genre." },
              dir: { type: "string", enum: ["h", "v"], description: "Placement for add_sample_to_track: 'h'=append after on active track, 'v'=new parallel track." },
              target: { type: "string", enum: ["track", "pattern"], description: "What save_to_library bounces: 'track'=whole timeline, 'pattern'=current sequencer pattern (default)." },
              params: {
                type: "object",
                description:
                  "Effect parameters for op=effects: gain, lpFreq, hpFreq, saturation, fadeIn, fadeOut, normalize, reverse, delay, delayTime, delayFb, compress, reverb, reverbDecay, chorus, chorusRate, bitCrush.",
                additionalProperties: true,
              },
              operations: {
                type: "array",
                description: "Nested operations for create_from.",
                items: { type: "object", additionalProperties: true },
              },
            },
            required: ["op"],
            additionalProperties: true,
          },
        },
      },
      required: ["message", "operations"],
      additionalProperties: false,
    },
  },
};

// ---- Validator: clamp/sanitize every op so non-finite / out-of-range values never reach the client ----
function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function toIndex(v: unknown): number | null {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function sanitizeParams(params: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!params || typeof params !== "object") return out;
  for (const [k, val] of Object.entries(params as Record<string, unknown>)) {
    if (typeof val === "number") { if (Number.isFinite(val)) out[k] = val; }
    else if (typeof val === "boolean") out[k] = val;
  }
  return out;
}

function sanitizeOp(r: unknown, warnings: string[]): any | null {
  if (!r || typeof r !== "object") { warnings.push("skipped non-object operation"); return null; }
  const o: any = { ...(r as object) };
  if (!OP_ENUM.includes(o.op)) { warnings.push(`unknown op "${o.op}" skipped`); return null; }
  if (o.bpm != null) o.bpm = clampNum(o.bpm, 20, 400, 128);
  if (o.swing != null) o.swing = clampNum(o.swing, 50, 75, 50);
  if (o.volume != null) o.volume = clampNum(o.volume, 0, 2, 0.8);
  if (o.pan != null) o.pan = clampNum(o.pan, -1, 1, 0);
  if (o.pitch != null) o.pitch = clampNum(o.pitch, 0.1, 4, 1);
  if (o.eqLow != null) o.eqLow = clampNum(o.eqLow, 0, 3, 1);
  if (o.eqMid != null) o.eqMid = clampNum(o.eqMid, 0, 3, 1);
  if (o.eqHigh != null) o.eqHigh = clampNum(o.eqHigh, 0, 3, 1);
  if (o.times != null) o.times = clampNum(o.times, 1, 64, 4);
  if (o.crossfade != null) o.crossfade = clampNum(o.crossfade, 0, 1, 0.02);
  if (o.start != null) o.start = clampNum(o.start, 0, 3600, 0);
  if (o.end != null) o.end = clampNum(o.end, 0, 3600, 0);
  if (o.time != null) o.time = clampNum(o.time, 0, 3600, 0);
  if (o.pattern != null) o.pattern = clampNum(o.pattern, 0, 7, 0);
  if (o.from != null) o.from = clampNum(o.from, 0, 7, 0);
  if (o.to != null) o.to = clampNum(o.to, 0, 7, 0);
  if (o.pulses != null) o.pulses = clampNum(Math.round(Number(o.pulses)), 0, 64, 4);
  if (o.rotate != null) o.rotate = clampNum(Math.round(Number(o.rotate)), -64, 64, 0);
  if (o.amount != null) o.amount = clampNum(o.amount, 0, 1, 0.3);
  if (o.op === "apply_genre") {
    const g = String(o.genre || "").toLowerCase();
    if (!GENRES.includes(g)) { warnings.push("apply_genre: unknown genre – skipped"); return null; }
    o.genre = g;
  }
  if (o.dir != null) { const d = String(o.dir).toLowerCase(); o.dir = d === "v" ? "v" : "h"; }
  if (o.target != null) { const t = String(o.target).toLowerCase(); o.target = t === "track" ? "track" : "pattern"; }
  if (o.channel != null) {
    const i = toIndex(o.channel);
    if (i == null) { warnings.push(`${o.op}: invalid channel index – skipped`); return null; }
    o.channel = i;
  }
  if (o.sample != null) { const i = toIndex(o.sample); if (i == null) delete o.sample; else o.sample = i; }
  if (o.source != null) { const i = toIndex(o.source); if (i == null) delete o.source; else o.source = i; }
  if (o.op === "shift_channel") {
    o.steps = clampNum(Math.round(Number(o.steps) || 0), -64, 64, 0);
  } else if (Array.isArray(o.steps)) {
    o.steps = o.steps.map((x: any) => (x ? 1 : 0));
  } else if (o.steps != null) {
    delete o.steps;
  }
  if (Array.isArray(o.velocities)) o.velocities = o.velocities.map((x: any) => clampNum(x, 0, 127, 80));
  if (Array.isArray(o.ratchets)) o.ratchets = o.ratchets.map((x: any) => clampNum(Math.floor(Number(x) || 1), 1, 8, 1));
  if (Array.isArray(o.samples)) o.samples = o.samples.map((x: any) => toIndex(x)).filter((x: any) => x != null);
  if (Array.isArray(o.gaps)) o.gaps = o.gaps.map((x: any) => clampNum(x, 0, 60, 0));
  if (o.params != null) o.params = sanitizeParams(o.params);
  if (o.op === "create_from") {
    if (Array.isArray(o.operations)) {
      const nested: any[] = [];
      for (const n of o.operations) { const s = sanitizeOp(n, warnings); if (s) nested.push(s); }
      o.operations = nested;
    } else if (o.operations != null) {
      o.operations = [];
    }
  }
  return o;
}

function validateOperations(raw: unknown): { commands: any[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!Array.isArray(raw)) {
    if (raw != null) warnings.push("operations was not an array – ignored");
    return { commands: [], warnings };
  }
  const commands: any[] = [];
  for (const r of raw) { const s = sanitizeOp(r, warnings); if (s) commands.push(s); }
  return { commands, warnings };
}

router.post("/ai/chat", async (req, res) => {
  try {
    const { messages, systemPrompt, context } = req.body as {
      messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
      systemPrompt: string;
      context?: string;
      mode?: string;
    };

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "messages array required" });
      return;
    }

    const fullSystem = context ? `${systemPrompt}\n${context}` : systemPrompt;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const validMessages = messages.slice(-14).map((m) => ({
      role: (m.role === "system" ? "user" : m.role) as "user" | "assistant",
      content: String(m.content),
    }));

    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 2500,
      messages: [{ role: "system", content: fullSystem }, ...validMessages],
      tools: [operationsTool],
      tool_choice: { type: "function", function: { name: "execute_audio_operations" } },
    });

    const choice = completion.choices[0];
    let message = "";
    let commands: any[] = [];
    let warnings: string[] = [];

    const toolCall = choice?.message?.tool_calls?.[0];
    if (toolCall && toolCall.type === "function") {
      try {
        const args = JSON.parse(toolCall.function.arguments || "{}");
        message = typeof args.message === "string" ? args.message : "";
        const v = validateOperations(args.operations);
        commands = v.commands;
        warnings = v.warnings;
      } catch {
        message = "Nepodarilo sa spracovať odpoveď AI. Skús to znova.";
      }
    } else {
      message = choice?.message?.content?.trim() || "";
    }

    if (!message) message = commands.length ? "Hotovo." : "Nerozumiem, skús to formulovať inak.";

    res.write(`data: ${JSON.stringify({ done: true, parsed: { message, commands, warnings } })}\n\n`);
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

export default router;
