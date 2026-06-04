import Replicate from "replicate";

export type DemucsModel = "htdemucs" | "htdemucs_6s" | "htdemucs_ft";

export interface DemucsOutput {
  vocals?: string;
  drums?: string;
  bass?: string;
  other?: string;
  guitar?: string;
  piano?: string;
}

const MODEL_TIMEOUTS_MS: Record<DemucsModel, number> = {
  htdemucs: 8 * 60 * 1000,
  htdemucs_6s: 12 * 60 * 1000,
  htdemucs_ft: 10 * 60 * 1000,
};

const POLL_MS = 10_000;
const DEMUCS_MODEL = "cjwbw/demucs";

function client(): Replicate {
  const token = process.env["REPLICATE_API_TOKEN"];
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set");
  return new Replicate({ auth: token });
}

export async function separateStems(
  audioBuffer: Buffer,
  model: DemucsModel,
  mimeType: string,
  onProgress: (msg: string) => void,
): Promise<DemucsOutput> {
  return runSeparation(audioBuffer, model, mimeType, onProgress, 0);
}

async function runSeparation(
  audioBuffer: Buffer,
  model: DemucsModel,
  mimeType: string,
  onProgress: (msg: string) => void,
  retryCount: number,
): Promise<DemucsOutput> {
  const rc = client();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  const timeoutMs = MODEL_TIMEOUTS_MS[model];

  onProgress(retryCount > 0 ? "Retrying separation..." : "Separating audio...");

  let prediction = await rc.predictions.create({
    model: DEMUCS_MODEL,
    input: { audio: blob, model, shifts: 1, overlap: 0.25 },
  });

  const start = Date.now();
  let warned = false;
  let processingStarted = false;

  while (
    prediction.status !== "succeeded" &&
    prediction.status !== "failed" &&
    prediction.status !== "canceled"
  ) {
    await sleep(POLL_MS);
    prediction = await rc.predictions.get(prediction.id);

    if (prediction.status === "starting") {
      onProgress("Waiting in queue...");
    } else if (prediction.status === "processing") {
      if (!processingStarted) processingStarted = true;
      onProgress("Separating audio...");
    }

    const elapsed = Date.now() - start;
    if (!warned && processingStarted && elapsed > timeoutMs * 0.8) {
      warned = true;
      onProgress("Still processing — this is taking longer than usual");
    }

    if (elapsed > timeoutMs) {
      if (retryCount < 1) {
        return runSeparation(audioBuffer, model, mimeType, onProgress, retryCount + 1);
      }
      throw new Error(
        "Separation timed out. Try again, or use a shorter/lighter recording.",
      );
    }
  }

  if (prediction.status !== "succeeded") {
    // Fallback: htdemucs_6s → htdemucs (never fallback htdemucs_ft per spec)
    if (model === "htdemucs_6s") {
      onProgress("Falling back to htdemucs...");
      return runSeparation(audioBuffer, "htdemucs", mimeType, onProgress, 0);
    }
    throw new Error(`Separation failed: ${prediction.error ?? "unknown"}`);
  }

  return parseOutput(prediction.output);
}

function parseOutput(output: unknown): DemucsOutput {
  if (!output || typeof output !== "object") {
    throw new Error("Unexpected Demucs output format");
  }
  return output as DemucsOutput;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
