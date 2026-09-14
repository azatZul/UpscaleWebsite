// The one place that talks to the auralens processing service.
//
// Authenticates with a bearer tool key that only this worker holds -- never the
// mobile apps' shared signing secret, which ships inside the app binaries.

import type { Operation } from "./pricing";

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

// Which endpoint and form fields each billable operation maps to. The two
// upscales share an endpoint; `advanced` selects the ultimate model.
export const OPERATION_ROUTES: Record<Operation, { path: string; fields: Record<string, string> }> = {
  upscale_standard: { path: "/creative-upscale", fields: { advanced: "false" } },
  upscale_ultimate: { path: "/creative-upscale", fields: { advanced: "true" } },
  restore: { path: "/restore-image", fields: {} },
};

/** Run one operation and return the provider's output URL. Throws
 *  AuralensError on anything that is not a clean success, so the caller has a
 *  single failure path to refund on. */
export async function runOperation(
  config: AuralensConfig,
  operation: Operation,
  image: Blob,
  filename: string,
): Promise<{ outputUrl: string }> {
  const route = OPERATION_ROUTES[operation];
  const form = new FormData();
  form.append("image", image, filename);
  for (const [name, value] of Object.entries(route.fields)) form.append(name, value);

  let response: Response;
  try {
    response = await (config.fetcher ?? fetch)(`${config.baseUrl.replace(/\/+$/, "")}${route.path}`, {
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
