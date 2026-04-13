import { NextRequest } from "next/server";

export const runtime = "edge";

type ProviderType = "openai" | "anthropic" | "gemini" | "custom";
type GenerationContextMode = "fast" | "full";

interface GenerateRequestBody {
  pageNumber: number;
  imageDataUrl: string;
  pdfTitle: string;
  contextMode: GenerationContextMode;
  historyContext: string;
  previousPageMarkdown: string;
  fullHistoryMarkdown: string;
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
const DEFAULT_CONTEXT_MODE: GenerationContextMode = "fast";
const MAX_OUTPUT_LANGUAGE_CHARS = 120;
const MAX_CUSTOM_PROMPT_CHARS = 4_000;
const MAX_FULL_HISTORY_CHARS = 400_000;

const PEDAGOGY_AND_DEPTH_PROMPT = `
CRITICAL INSTRUCTIONS FOR PEDAGOGY & DEPTH (STRICT):
1. ANTI-PARROTING: Cover ALL the content, but Do NOT just read the slide text out loud. Synthesize and abbreviate the text blocks into a conversational but dense academic explanation.
2. MANDATORY MATH WALKTHROUGH: You MUST explain at least the core steps of EVERY formula or derivation present on the slide. Define the key variables and explain the intuition behind the math. Do not skip or gloss over the mathematics.
3. VISUAL GROUNDING: You MUST explicitly analyze and incorporate any charts, graphs, diagrams, or architecture figures on the slide into your lecture. Reference them directly in your prose (e.g., "As illustrated in the graph on the right, the curve indicates...", "Notice the architecture diagram here, where component X connects to Y...").
4. VISUAL HIERARCHY & CUES: You MUST actively interpret the spatial layout and typographical cues on the slide.
   - Positioning: Content placed at the top, center, or in larger font is likely more important. If the slide has a title, it often encapsulates the main theme.
   - Punctuation Intent: Pay close attention to punctuations such as '?' and '!'. e.g. A question mark ('?') often indicates a core problem statement, a gap in knowledge, or a rhetorical question—you MUST frame your explanation by posing this question to the audience before answering it. An exclamation mark ('!') indicates a critical pitfall, a surprising breakthrough, or a strict rule—you MUST emphasize this with a strong warning or assertion.
   - Arrows/Lines: Treat arrows as explicit indicators of causality, state transitions, or logical flow (e.g., A -> B). Explain this relationship explicitly.
   - Typography & Color: Pay close attention to bold, italic, differently sized, or colored text. These indicate emphasis or distinct categories. If a concept is visually emphasized on the slide, you MUST emphasize its importance in your lecture explanation.
   - Grouping: If items are grouped visually (e.g., in boxes or columns), explain the relationship or contrast between these groups.
`;

const TRUTH_AND_GROUNDING_PROMPT = `
CRITICAL INSTRUCTIONS FOR TRUTH & GROUNDING (STRICT):
1. EVIDENCE BOUNDARY: You may use ONLY these inputs as facts: (a) the current slide image, (b) PDF title, (c) provided memory/history context (rolling summary or full previous notes), and (d) previous page markdown when provided. Do NOT invent any additional context.
2. NO FABRICATION: Do NOT fabricate definitions, equations, variable meanings, dataset names, experiment settings, citations, theorem names, historical facts, or page-to-page transitions that are not explicitly present in the allowed inputs.
3. AMBIGUITY HANDLING: If text, symbols, or figures are blurry/occluded/ambiguous, state that they are unclear and continue with only what is confidently visible. Do NOT guess missing tokens or numbers.
4. CONTINUITY DISCIPLINE: Use prior context only for consistency of already introduced symbols/terms. If a needed definition is not present in current inputs, do not claim it as known.
5. SOURCE PRIORITY: When there is any conflict, trust the current slide image over prior memory text. Never override visible slide content with speculative interpretation.
6. MEMORY SAFETY: In <memory_update>, include only high-confidence technical facts that are explicitly supported by the current slide. Do NOT add speculative forecasts about future slides.
`;

function buildSystemPrompt(body: GenerateRequestBody) {
  const outputLanguage = body.outputLanguage.trim() || DEFAULT_OUTPUT_LANGUAGE;
  const customPrompt = body.customPrompt.trim() || "(none)";

  return `You are an expert professor giving an advanced technical lecture.

CRITICAL INSTRUCTIONS FOR NARRATIVE FLOW:
1. You are in the MIDDLE of a continuous lecture. DO NOT output any greetings, pleasantries, or sign-offs (e.g., never say "Welcome back", "Let's continue", "In conclusion", or "Now let's look at").
2. Get straight to the technical point of the current slide immediately.
3. You have been provided with 'Previous Context' and 'Memory'. Use this ONLY to ensure your mathematical and logical definitions are consistent with what you said before. DO NOT explicitly repeat or summarize the previous context in your output.
4. Explain the current slide as if it is a seamless continuation of the previous paragraph.

${PEDAGOGY_AND_DEPTH_PROMPT}

${TRUTH_AND_GROUNDING_PROMPT}

=== USER PREFERENCES (HIGHEST PRIORITY FOR STYLE & CONTENT) ===
OUTPUT LANGUAGE: You MUST output all explanations, lectures, and summaries entirely in ${outputLanguage}. (Math formulas remain in standard LaTeX).
CUSTOM INSTRUCTIONS: ${customPrompt}
(Note: You must follow the custom instructions above for the tone, depth, and style of your explanation. However, you MUST still obey the strict XML output structure below).
===============================================================

You MUST structure your response EXACTLY like this, regardless of custom instructions:
<lecture>
[Markdown lecture text in ${outputLanguage}, strictly using $$ for block math and $ for inline math. Do NOT use \\[ or \\( ]
</lecture>
<memory_update>
[Extract 1 to 3 crucial technical takeaways in ${outputLanguage}. STRICT budget of max 50 words.]
</memory_update>
`;
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

function buildUserPrompt(body: GenerateRequestBody) {
  if (body.contextMode === "full") {
    const fullHistoryMarkdown = body.fullHistoryMarkdown.trim() || "(none)";

    return [
      `PDF Title/Summary: ${body.pdfTitle || "Untitled PDF"}`,
      "",
      "Context mode: FULL (precision-first).",
      "Accumulated markdown history from all previous pages (1 to N-1):",
      fullHistoryMarkdown,
      "",
      `Current page number (N): ${body.pageNumber}`,
      "Use the attached page image as the primary source of truth.",
    ].join("\n");
  }

  const historyContext = body.historyContext.trim() || "(none)";
  const previousPageMarkdown = body.previousPageMarkdown.trim() || "(none)";

  return [
    `PDF Title/Summary: ${body.pdfTitle || "Untitled PDF"}`,
    "",
    "Context mode: FAST (token-efficient rolling memory).",
    "Accumulated context from earlier pages (1 to N-2):",
    historyContext,
    "",
    "Exact markdown from previous page (N-1):",
    previousPageMarkdown,
    "",
    `Current page number (N): ${body.pageNumber}`,
    "Use the attached page image as the primary source of truth.",
  ].join("\n");
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

function sanitizeContextMode(value: unknown): GenerationContextMode {
  if (value === "full") {
    return "full";
  }
  return DEFAULT_CONTEXT_MODE;
}

function sanitizeFullHistoryMarkdown(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.slice(0, MAX_FULL_HISTORY_CHARS);
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
  const systemPrompt = buildSystemPrompt(body);

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
  const systemPrompt = buildSystemPrompt(body);
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
    imageDataUrl: payload.imageDataUrl,
    pdfTitle: typeof payload.pdfTitle === "string" ? payload.pdfTitle : "",
    contextMode: sanitizeContextMode(payload.contextMode),
    historyContext:
      typeof payload.historyContext === "string" ? payload.historyContext : "",
    previousPageMarkdown:
      typeof payload.previousPageMarkdown === "string"
        ? payload.previousPageMarkdown
        : "",
    fullHistoryMarkdown: sanitizeFullHistoryMarkdown(payload.fullHistoryMarkdown),
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
