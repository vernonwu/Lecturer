import { NextRequest } from "next/server";
import {
  buildMainGenerationSystemPrompt,
  normalizeSlideTakeaway,
  type SlideTakeaway,
} from "@/lib/lecture-prompts";

export const runtime = "edge";

type ProviderType = "openai" | "anthropic" | "gemini" | "custom";

interface GenerateRequestBody {
  pageNumber: number;
  totalSlides: number;
  imageDataUrl: string;
  pdfTitle: string;
  takeaways: SlideTakeaway[];
  previousPageMarkdown: string;
  outputLanguage: string;
  customPrompt: string;
}

interface ProviderConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_OUTPUT_LANGUAGE = "English";
const MAX_OUTPUT_LANGUAGE_CHARS = 120;
const MAX_CUSTOM_PROMPT_CHARS = 4_000;
const MAX_PREVIOUS_PAGE_CHARS = 120_000;
const MAX_TAKEAWAYS = 500;

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

function sanitizeOutputLanguage(value: unknown) {
  if (typeof value !== "string") {
    return DEFAULT_OUTPUT_LANGUAGE;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_OUTPUT_LANGUAGE;
  }
  return trimmed.slice(0, MAX_OUTPUT_LANGUAGE_CHARS);
}

function sanitizeCustomPrompt(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, MAX_CUSTOM_PROMPT_CHARS);
}

function sanitizePreviousPageMarkdown(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.slice(0, MAX_PREVIOUS_PAGE_CHARS);
}

function sanitizeTakeaways(value: unknown): SlideTakeaway[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_TAKEAWAYS)
    .map((item, index) => normalizeSlideTakeaway(item, index + 1))
    .sort((a, b) => a.slide_number - b.slide_number);
}

function buildUserPrompt(body: GenerateRequestBody) {
  return [
    `PDF Title/Summary: ${body.pdfTitle || "Untitled PDF"}`,
    `Current slide: ${body.pageNumber}/${Math.max(1, body.totalSlides)}`,
    "Use the attached slide image as the primary source of truth.",
    "Continue naturally from the previous slide markdown provided in system context.",
  ].join("\n");
}

function extractOpenAiDelta(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const choice = (payload as { choices?: unknown[] }).choices?.[0] as
    | {
      delta?: { content?: unknown };
      message?: { content?: unknown };
    }
    | undefined;
  if (!choice) {
    return "";
  }

  const fromDelta = choice.delta?.content;
  if (typeof fromDelta === "string") {
    return fromDelta;
  }
  if (Array.isArray(fromDelta)) {
    return fromDelta
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

  const fromMessage = choice.message?.content;
  if (typeof fromMessage === "string") {
    return fromMessage;
  }
  if (Array.isArray(fromMessage)) {
    return fromMessage
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

  return "";
}

async function streamSseResponse(
  response: Response,
  onEvent: (eventName: string, data: string) => void | Promise<void>,
) {
  if (!response.body) {
    throw new Error("Upstream provider returned an empty stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeRawEvent = async (rawEvent: string) => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of rawEvent.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    const data = dataLines.join("\n");
    await onEvent(eventName, data);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    while (true) {
      const separatorIndex = buffer.indexOf("\n\n");
      if (separatorIndex === -1) {
        break;
      }

      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      await consumeRawEvent(rawEvent);
    }
  }

  buffer += decoder.decode().replace(/\r\n/g, "\n");
  while (true) {
    const separatorIndex = buffer.indexOf("\n\n");
    if (separatorIndex === -1) {
      break;
    }
    const rawEvent = buffer.slice(0, separatorIndex);
    buffer = buffer.slice(separatorIndex + 2);
    await consumeRawEvent(rawEvent);
  }
  if (buffer.trim()) {
    await consumeRawEvent(buffer);
  }
}

async function requestOpenAiCompatibleStream(
  body: GenerateRequestBody,
  config: ProviderConfig,
  signal: AbortSignal,
  onToken: (token: string) => void,
) {
  const endpoint = buildEndpoint(config.baseUrl, "/chat/completions");
  const userPrompt = buildUserPrompt(body);
  const systemPrompt = buildMainGenerationSystemPrompt({
    pageNumber: body.pageNumber,
    availableTakeaways: body.takeaways,
    previousPageMarkdown: body.previousPageMarkdown,
    outputLanguage: body.outputLanguage,
    customPrompt: body.customPrompt,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const upstreamResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: config.model,
      stream: true,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: userPrompt,
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

  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text();
    throw new Error(
      `Upstream request failed (${upstreamResponse.status}): ${errorText.slice(0, 500)}`,
    );
  }

  await streamSseResponse(upstreamResponse, (eventName, data) => {
    if (eventName === "ping" || !data) {
      return;
    }
    if (data === "[DONE]") {
      return;
    }

    const parsed = JSON.parse(data);
    const token = extractOpenAiDelta(parsed);
    if (token) {
      onToken(token);
    }
  });
}

async function requestAnthropicStream(
  body: GenerateRequestBody,
  config: ProviderConfig,
  signal: AbortSignal,
  onToken: (token: string) => void,
) {
  const endpoint = buildEndpoint(config.baseUrl, "/messages");
  const userPrompt = buildUserPrompt(body);
  const systemPrompt = buildMainGenerationSystemPrompt({
    pageNumber: body.pageNumber,
    availableTakeaways: body.takeaways,
    previousPageMarkdown: body.previousPageMarkdown,
    outputLanguage: body.outputLanguage,
    customPrompt: body.customPrompt,
  });
  const parsedImage = parseDataUrlImage(body.imageDataUrl);

  const upstreamResponse = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2500,
      stream: true,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: userPrompt,
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

  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text();
    throw new Error(
      `Upstream request failed (${upstreamResponse.status}): ${errorText.slice(0, 500)}`,
    );
  }

  await streamSseResponse(upstreamResponse, (eventName, data) => {
    if (!data || eventName === "ping") {
      return;
    }
    if (data === "[DONE]") {
      return;
    }

    if (eventName === "content_block_delta") {
      const parsed = JSON.parse(data) as {
        delta?: { type?: string; text?: string };
      };
      if (parsed.delta?.type === "text_delta" && parsed.delta.text) {
        onToken(parsed.delta.text);
      }
    }
  });
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

function assertGenerateBody(body: unknown): GenerateRequestBody {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }

  const payload = body as Partial<GenerateRequestBody>;
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
    totalSlides:
      typeof payload.totalSlides === "number" && Number.isFinite(payload.totalSlides)
        ? Math.max(1, Math.floor(payload.totalSlides))
        : payload.pageNumber,
    imageDataUrl: payload.imageDataUrl,
    pdfTitle: typeof payload.pdfTitle === "string" ? payload.pdfTitle : "",
    takeaways: sanitizeTakeaways(payload.takeaways),
    previousPageMarkdown: sanitizePreviousPageMarkdown(payload.previousPageMarkdown),
    outputLanguage: sanitizeOutputLanguage(payload.outputLanguage),
    customPrompt: sanitizeCustomPrompt(payload.customPrompt),
  };
}

export async function POST(request: NextRequest) {
  let payload: GenerateRequestBody;
  let providerConfig: ProviderConfig;

  try {
    payload = assertGenerateBody(await request.json());
    providerConfig = readProviderConfig(request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid generation request.";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const sendEvent = (eventName: string, data: unknown) => {
        if (closed) {
          return;
        }
        const payloadText =
          typeof data === "string" ? data : JSON.stringify(data);
        controller.enqueue(
          encoder.encode(`event: ${eventName}\ndata: ${payloadText}\n\n`),
        );
      };

      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      const fail = (error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Generation failed.";
        sendEvent("error", { message });
        close();
      };

      (async () => {
        try {
          if (providerConfig.provider === "anthropic") {
            await requestAnthropicStream(
              payload,
              providerConfig,
              request.signal,
              (token) => {
                sendEvent("token", { delta: token });
              },
            );
          } else {
            await requestOpenAiCompatibleStream(
              payload,
              providerConfig,
              request.signal,
              (token) => {
                sendEvent("token", { delta: token });
              },
            );
          }

          sendEvent("done", { ok: true });
          close();
        } catch (error) {
          fail(error);
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
