import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { separateStems, type DemucsModel } from "../services/replicate.js";
import {
  smartPreview,
  analyzeStems,
  verifyZoomExtraction,
  type SmartPreviewResult,
  type StemAnalysis,
  type ZoomVerification,
} from "../services/gemini.js";

const router = Router();

// Multer: store uploaded file in memory (no disk, per spec decision)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ["audio/wav", "audio/mpeg", "audio/ogg", "audio/flac",
      "audio/x-m4a", "audio/aac", "audio/webm", "audio/mp4", "audio/x-wav"];
    const ok = allowed.includes(file.mimetype) || file.originalname.match(/\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i) !== null;
    cb(null, ok);
  },
});

type Mode = "track" | "stem" | "zoom";

const MODEL_MAP: Record<Mode, DemucsModel> = {
  track: "htdemucs",
  stem: "htdemucs_6s",
  zoom: "htdemucs_ft",
};

// Helper: send SSE event
function sse(res: any, event: object) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

router.post("/decompose", upload.single("audio"), async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const mode = (req.body?.mode as Mode) || "track";
    const targetInstrument = req.body?.target_instrument as string | undefined;
    const fragmentStart = req.body?.fragment_start as string | undefined;
    const fragmentEnd = req.body?.fragment_end as string | undefined;

    if (!req.file) {
      sse(res, { step: "error", message: "No audio file provided." });
      res.end(); return;
    }

    const audioBuffer = req.file.buffer;
    const mimeType = req.file.mimetype || "audio/wav";
    const trackId = randomUUID();

    // ── STEP 1: Smart Preview (quality gate + orientation) ──────────────
    sse(res, { step: "preview", message: "Analyzing recording..." });

    let preview: SmartPreviewResult;
    try {
      // For large files, send only first ~3 min worth of bytes (≈ 3 MB for MP3)
      const previewBuf = audioBuffer.length > 3 * 1024 * 1024
        ? audioBuffer.subarray(0, 3 * 1024 * 1024)
        : audioBuffer;
      preview = await smartPreview(previewBuf, mimeType);
    } catch (e: any) {
      sse(res, { step: "error", message: `Smart Preview failed: ${e.message}` });
      res.end(); return;
    }

    sse(res, { step: "preview_done", data: preview });

    if (!preview.quality_ok) {
      sse(res, {
        step: "error",
        message: `Recording quality is insufficient for separation: ${preview.quality_reason ?? "unusable audio"}`,
      });
      res.end(); return;
    }

    // ── STEP 2: Separation (Demucs via Replicate) ────────────────────────
    const demucsModel = MODEL_MAP[mode];
    let stems: Record<string, string>;

    try {
      const output = await separateStems(
        audioBuffer,
        demucsModel,
        mimeType,
        (msg) => sse(res, { step: "separating", message: msg }),
      );
      stems = output as Record<string, string>;
    } catch (e: any) {
      sse(res, { step: "error", message: e.message });
      res.end(); return;
    }

    sse(res, { step: "separating_done", data: { stem_urls: stems } });

    // ── STEP 3: Download stems from Replicate URLs ───────────────────────
    sse(res, { step: "analyzing", message: "Identifying instruments..." });

    const stemBuffers: Array<{ name: string; buffer: Buffer; mimeType: string; url: string }> = [];

    for (const [stemName, stemUrl] of Object.entries(stems)) {
      if (!stemUrl) continue;
      try {
        const resp = await fetch(stemUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const arrayBuf = await resp.arrayBuffer();
        stemBuffers.push({
          name: `${stemName}.wav`,
          buffer: Buffer.from(arrayBuf),
          mimeType: "audio/wav",
          url: stemUrl,
        });
      } catch (e: any) {
        // Non-fatal: include stem without analysis if download fails
        stemBuffers.push({ name: `${stemName}.wav`, buffer: Buffer.alloc(0), mimeType: "audio/wav", url: stemUrl });
      }
    }

    // ── STEP 4: Gemini analysis (skip for Track Analysis to keep it fast) ─
    let layers: StemAnalysis[] = [];
    let zoomVerification: ZoomVerification | null = null;

    const validBuffers = stemBuffers.filter((s) => s.buffer.length > 0);

    if (mode === "stem" && validBuffers.length > 0) {
      try {
        layers = await analyzeStems(
          validBuffers.map((s) => ({ name: s.name, buffer: s.buffer, mimeType: s.mimeType })),
          { genre: preview.genre, bpm: preview.bpm, key: preview.key },
        );
      } catch (e: any) {
        // Deliver stems without analysis if Gemini fails (per spec error handling)
        layers = [];
      }
    }

    if (mode === "track" && validBuffers.length > 0) {
      // Light tagging for Track Analysis (use "other" stem for tagging)
      const otherStem = validBuffers.find((s) => s.name.includes("other")) ?? validBuffers[0];
      try {
        const lightAnalysis = await analyzeStems(
          [{ name: otherStem.name, buffer: otherStem.buffer, mimeType: otherStem.mimeType }],
          { genre: preview.genre, bpm: preview.bpm, key: preview.key },
        );
        layers = lightAnalysis;
      } catch {
        layers = [];
      }
    }

    if (mode === "zoom" && validBuffers.length > 0) {
      let iterCount = 0;
      const maxIter = 3;

      while (iterCount < maxIter) {
        try {
          zoomVerification = await verifyZoomExtraction(
            validBuffers.map((s) => ({ name: s.name, buffer: s.buffer, mimeType: s.mimeType })),
            targetInstrument ?? "target instrument",
            { start: fragmentStart ?? "0:00", end: fragmentEnd ?? "0:30" },
          );
        } catch {
          break;
        }

        iterCount++;
        sse(res, { step: "zoom_iteration", data: { iteration: iterCount, confidence: zoomVerification.confidence } });

        if (zoomVerification.confidence >= 0.8) break;
        if (iterCount >= maxIter) break;
        // Could refine parameters here in future — for now just log
        sse(res, { step: "zoom_refining", message: zoomVerification.improvement_suggestion ?? "Refining extraction..." });
      }
    }

    // ── STEP 5: Finalize output (GPT-4o formats final JSON) ─────────────
    sse(res, { step: "finalizing", message: "Preparing results..." });

    // Build escalation suggestions for confidence < 0.6
    const escalations = layers
      .filter((l) => l.confidence < 0.6)
      .map((l) => ({
        layer_name: l.layer_name,
        confidence: l.confidence,
        reason: `Cannot clearly identify instruments in ${l.stem_file}`,
        suggested_range: getTimestampRange(l),
        message: `Analysis uncertain for "${l.layer_name}" (confidence: ${Math.round(l.confidence * 100)}%). Run Deep Zoom?`,
      }));

    // Build stems list for frontend
    const stemsList = stemBuffers.map((s) => ({
      stem_id: randomUUID(),
      filename: s.name,
      file_url: s.url, // Replicate URL — frontend fetches & decodes
      demucs_label: s.name.replace(".wav", ""),
    }));

    const output = {
      track_id: trackId,
      mode,
      status: "complete" as const,
      smart_preview: preview,
      stems: stemsList,
      layers: layers.map((l, i) => ({
        layer_id: randomUUID(),
        stem_id: stemsList[i]?.stem_id ?? null,
        ...l,
      })),
      zoom_result: zoomVerification
        ? {
            target: targetInstrument,
            fragment_range: { start: fragmentStart, end: fragmentEnd },
            ...zoomVerification,
          }
        : null,
      escalation_suggestions: escalations,
    };

    sse(res, { step: "done", data: output });
  } catch (err: any) {
    sse(res, { step: "error", message: err?.message ?? "Unexpected error" });
  }

  res.end();
});

function getTimestampRange(layer: StemAnalysis): { start: string; end: string } {
  if (layer.timestamps?.length >= 2) {
    return { start: layer.timestamps[0].time, end: layer.timestamps[layer.timestamps.length - 1].time };
  }
  return { start: "0:00", end: "0:30" };
}

export default router;
