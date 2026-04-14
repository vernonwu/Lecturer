import { NextRequest } from "next/server";
import {
  TAKEAWAY_EXTRACTOR_PROMPT,
  normalizeSlideTakeaway,
} from "@/lib/lecture-prompts";

export const runtime = "edge";

type ProviderType = "openai" | "anthropic" | "gemini" | "custom";

interface ExtractTakeawayBody {
  pageNumber: number;
  imageDataUrl: string;
  pdfTitle: string;
  outputLanguage: string;
}

interface ProviderConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
}

function toProviderType(value: string | null): ProviderType | null {
  if (
    value === "openai" ||
    value === "anthropic" ||
    value === "gemini" ||
    value === "custom"
  ) {
    return value;
  }
  return null;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function buildEndpoint(baseUrl: string, suffix: string) {
  return `${trimTrailingSlash(baseUrl)}${suffix}`;
}

function parseDataUrlImage(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image payload. Expected a base64 data URL.");
  }
  return {
    mediaType: match[1],
    base64Data: match[2],
  };
}

function readProviderConfig(request: NextRequest): ProviderConfig {
  const provider = toProviderType(request.headers.get("x-lecturer-provider"));
  const baseUrl = request.headers.get("x-lecturer-base-url")?.trim() || "";
  const model = request.headers.get("x-lecturer-model")?.trim() || "";
  const apiKey = request.headers.get("x-lecturer-api-key")?.trim() || "";

  if (!provider) {
    throw new Error("Missing or invalid provider header.");
  }
  if (!baseUrl) {
    throw new Error("Missing base URL header.");
  }
  if (!model) {
    throw new Error("Missing model header.");
  }
  if (provider !== "custom" && !apiKey) {
    throw new Error("API key is required for the selected provider.");
  }

  return {
    provider,
    baseUrl,
    model,
    apiKey,
  };
}

function assertBody(body: unknown): ExtractTakeawayBody {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }

  const payload = body as Partial<ExtractTakeawayBody>;

  if (
    typeof payload.pageNumber !== "number" ||
    !Number.isFinite(payload.pageNumber) ||
    payload.pageNumber < 1
  ) {
    throw new Error("Invalid page number.");
  }

  if (typeof payload.imageDataUrl !== "string" || !payload.imageDataUrl) {
    throw new Error("Missing page image.");
  }

  return {
    pageNumber: payload.pageNumber,
    imageDataUrl: payload.imageDataUrl,
    pdfTitle: typeof payload.pdfTitle === "string" ? payload.pdfTitle : "",
    outputLanguage:
      typeof payload.outputLanguage === "string" && payload.outputLanguage.trim()
        ? payload.outputLanguage.trim().slice(0, 120)
        : "English",
  };
}

function extractOpenAiMessageContent(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const choice = (payload as { choices?: unknown[] }).choices?.[0] as
    | {
      message?: { content?: unknown };
    }
    | undefined;
  if (!choice) {
    return "";
  }

  const content = choice.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) =>
      typeof part === "object" &&
      part !== null &&
      "text" in part &&
      typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("");
}

function extractAnthropicMessageContent(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const content = (payload as { content?: unknown[] }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) =>
      typeof part === "object" &&
      part !== null &&
      "text" in part &&
      typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("");
}

function extractJsonObject(text: string) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fencedMatch ? fencedMatch[1] : text).trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Extractor response did not contain a JSON object.");
  }
  return candidate.slice(firstBrace, lastBrace + 1);
}

function buildUserPrompt(body: ExtractTakeawayBody) {
  return [
    `Slide number: ${body.pageNumber}`,
    `Document title: ${body.pdfTitle || "Untitled PDF"}`,
    `Target language for "core_concept": ${body.outputLanguage}`,
    "Use the attached slide image as the source of truth.",
    "Return only one strict JSON object and no extra commentary.",
  ].join("\n");
}

async function requestOpenAiTakeaway(
  body: ExtractTakeawayBody,
  provider: ProviderConfig,
  signal: AbortSignal,
) {
  const endpoint = buildEndpoint(provider.baseUrl, "/chat/completions");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({
      model: provider.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: TAKEAWAY_EXTRACTOR_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildUserPrompt(body),
            },
            {
              type: "image_url",
              image_url: {
                url: body.imageDataUrl,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Upstream request failed (${response.status}): ${errorText.slice(0, 500)}`,
    );
  }

  const payload = await response.json();
  return extractOpenAiMessageContent(payload);
}

async function requestAnthropicTakeaway(
  body: ExtractTakeawayBody,
  provider: ProviderConfig,
  signal: AbortSignal,
) {
  const endpoint = buildEndpoint(provider.baseUrl, "/messages");
  const parsedImage = parseDataUrlImage(body.imageDataUrl);

  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 300,
      temperature: 0,
      system: TAKEAWAY_EXTRACTOR_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildUserPrompt(body),
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: parsedImage.mediaType,
                data: parsedImage.base64Data,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Upstream request failed (${response.status}): ${errorText.slice(0, 500)}`,
    );
  }

  const payload = await response.json();
  return extractAnthropicMessageContent(payload);
}

export async function POST(request: NextRequest) {
  let body: ExtractTakeawayBody;
  let provider: ProviderConfig;

  try {
    body = assertBody(await request.json());
    provider = readProviderConfig(request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid extraction request.";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  try {
    const rawText =
      provider.provider === "anthropic"
        ? await requestAnthropicTakeaway(body, provider, request.signal)
        : await requestOpenAiTakeaway(body, provider, request.signal);
    const rawJson = extractJsonObject(rawText);
    const parsed = JSON.parse(rawJson);
    const takeaway = normalizeSlideTakeaway(parsed, body.pageNumber);

    return new Response(JSON.stringify({ takeaway }), {
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Takeaway extraction failed.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
