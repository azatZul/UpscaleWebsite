// The one place that talks to the auralens processing service.
//
// Authenticates with a bearer tool key that only this worker holds -- never the
// mobile apps' shared signing secret, which ships inside the app binaries.

import type { CloudRequest, RestoreMode } from "./pricing";

const TIMEOUT_MS = 180_000;

export class AuralensError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "AuralensError";
  }
}

export interface AuralensConfig {
  baseUrl: string;
  apiKey: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

// Copied from the iOS app's PhotoRestoreMode.prompt, so the website and the app
// ask the model for the same restoration. Advanced Fix uses a dedicated model
// and takes no prompt.
export const RESTORE_PROMPTS: Record<Exclude<RestoreMode, "advanced_restoration">, string> = {
  restore: "Remove scratches, dust, folds, and fix any torn or missing parts. Slightly enhance overall image quality while keeping original colors, faces, and lighting unchanged.",
  colorization: "Fix cracks, folds, and scratches. Colorize. Remove any borders or blank edges and outpaint the image to full frame.",
  colorization_pro: "Fix cracks, folds, and scratches. Colorize. Remove any borders or blank edges and outpaint the image to full frame.",
};

/** Endpoint and form for one request, following the routing the iOS app uses:
 *  creative upscale on the WaveSpeed upscaler, Advanced Fix on restore-image,
 *  and the other restore modes as Flux 2 edits (pro for Enhanced Colorize). */
export function buildAuralensRequest(request: CloudRequest, image: Blob, filename: string): { path: string; form: FormData } {
  const form = new FormData();
  if (request.kind === "creative") {
    form.append("image", image, filename);
    form.append("creativity", String(request.creativity));
    form.append("target_resolution", request.resolution);
    form.append("output_format", "jpeg");
    form.append("advanced", "false");
    return { path: "/creative-upscale", form };
  }
  if (request.mode === "advanced_restoration") {
    form.append("image", image, filename);
    form.append("output_format", "jpg");
    return { path: "/restore-image", form };
  }
  const mode = request.mode as Exclude<RestoreMode, "advanced_restoration">;
  form.append("image1", image, filename);
  form.append("prompt", RESTORE_PROMPTS[mode]);
  if (request.prompt) {
    form.append("user_prompt", request.prompt);
    form.append("improve_user_prompt", "true");
  }
  form.append("increase_resolution", String(request.increaseResolution));
  form.append("aspect_ratio", "match_input_image");
  form.append("output_format", "jpg");
  return { path: mode === "colorization_pro" ? "/edit-flux-2-pro" : "/edit-flux-2-dev", form };
}

/** Run one request and return the provider's output URL. Throws AuralensError
 *  on anything that is not a clean success, so the caller has a single failure
 *  path to refund on. */
export async function runCloudRequest(
  config: AuralensConfig,
  request: CloudRequest,
  image: Blob,
  filename: string,
): Promise<{ outputUrl: string }> {
  const { path, form } = buildAuralensRequest(request, image, filename);
  let response: Response;
  try {
    response = await (config.fetcher ?? fetch)(`${config.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "app-id": "UScaleWeb" },
      body: form,
      signal: AbortSignal.timeout(config.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AuralensError(timedOut ? "Processing timed out" : "Could not reach the processing service");
  }

  const body = await response.json().catch(() => null) as { output_url?: unknown } | null;
  if (!response.ok) throw new AuralensError(`Processing service returned ${response.status}`, response.status);
  const outputUrl = body?.output_url;
  if (typeof outputUrl !== "string" || !/^https:\/\//.test(outputUrl)) {
    throw new AuralensError("Processing service returned no result URL", response.status);
  }
  return { outputUrl };
}
