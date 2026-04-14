"use client";

import { useCallback } from "react";
import type { ProviderType } from "@/types/settings";
import {
  normalizeSlideTakeaway,
  type SlideTakeaway,
} from "@/lib/lecture-prompts";

interface GenerateRequestPayload {
  pageNumber: number;
  totalSlides: number;
  imageDataUrl: string;
  pdfTitle: string;
  takeaways: SlideTakeaway[];
  previousPageMarkdown: string;
  outputLanguage: string;
  customPrompt: string;
}

interface ProviderRequestHeaders {
  provider: ProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface LectureStreamParams {
  request: GenerateRequestPayload;
  provider: ProviderRequestHeaders;
  signal?: AbortSignal;
  onLectureChunk: (chunk: string) => void;
  onMemoryChunk: (chunk: string) => void;
}

interface ExtractTakeawayRequestPayload {
  pageNumber: number;
  imageDataUrl: string;
  pdfTitle: string;
  outputLanguage: string;
}

interface ExtractTakeawayParams {
  request: ExtractTakeawayRequestPayload;
  provider: ProviderRequestHeaders;
  signal?: AbortSignal;
}

interface XmlParserHandlers {
  onLectureChunk: (chunk: string) => void;
  onMemoryChunk: (chunk: string) => void;
}

interface XmlParserState {
  lectureMarkdown: string;
  memoryUpdate: string;
}

type ParseMode =
  | "before_lecture"
  | "inside_lecture"
  | "after_lecture"
  | "inside_memory"
  | "done";

const OPEN_LECTURE = "<lecture>";
const CLOSE_LECTURE = "</lecture>";
const OPEN_MEMORY = "<memory_update>";
const CLOSE_MEMORY = "</memory_update>";

function createXmlStreamParser(handlers: XmlParserHandlers) {
  let mode: ParseMode = "before_lecture";
  let buffer = "";
  const state: XmlParserState = {
    lectureMarkdown: "",
    memoryUpdate: "",
  };

  const appendLecture = (chunk: string) => {
    if (!chunk) {
      return;
    }
    state.lectureMarkdown += chunk;
    handlers.onLectureChunk(chunk);
  };

  const appendMemory = (chunk: string) => {
    if (!chunk) {
      return;
    }
    state.memoryUpdate += chunk;
    handlers.onMemoryChunk(chunk);
  };

  const trimToGuardSize = (targetTag: string) => {
    const guardSize = targetTag.length - 1;
    if (buffer.length > guardSize) {
      buffer = buffer.slice(-guardSize);
    }
  };

  const flushUntilClosingTag = (
    closingTag: string,
    appendChunk: (chunk: string) => void,
    isFinal: boolean,
  ) => {
    const closingIndex = buffer.indexOf(closingTag);
    if (closingIndex === -1) {
      if (isFinal) {
        appendChunk(buffer);
        buffer = "";
      } else {
        const guardSize = closingTag.length - 1;
        const flushLength = Math.max(0, buffer.length - guardSize);
        if (flushLength > 0) {
          appendChunk(buffer.slice(0, flushLength));
          buffer = buffer.slice(flushLength);
        }
      }
      return false;
    }

    appendChunk(buffer.slice(0, closingIndex));
    buffer = buffer.slice(closingIndex + closingTag.length);
    return true;
  };

  const processBuffer = (isFinal: boolean) => {
    while (true) {
      if (mode === "done") {
        buffer = "";
        return;
      }

      if (mode === "before_lecture") {
        const startIndex = buffer.indexOf(OPEN_LECTURE);
        if (startIndex === -1) {
          if (isFinal) {
            buffer = "";
          } else {
            trimToGuardSize(OPEN_LECTURE);
          }
          return;
        }
        buffer = buffer.slice(startIndex + OPEN_LECTURE.length);
        mode = "inside_lecture";
        continue;
      }

      if (mode === "inside_lecture") {
        const closed = flushUntilClosingTag(CLOSE_LECTURE, appendLecture, isFinal);
        if (!closed) {
          return;
        }
        mode = "after_lecture";
        continue;
      }

      if (mode === "after_lecture") {
        const startIndex = buffer.indexOf(OPEN_MEMORY);
        if (startIndex === -1) {
          if (isFinal) {
            buffer = "";
          } else {
            trimToGuardSize(OPEN_MEMORY);
          }
          return;
        }
        buffer = buffer.slice(startIndex + OPEN_MEMORY.length);
        mode = "inside_memory";
        continue;
      }

      if (mode === "inside_memory") {
        const closed = flushUntilClosingTag(CLOSE_MEMORY, appendMemory, isFinal);
        if (!closed) {
          return;
        }
        mode = "done";
        continue;
      }
    }
  };

  return {
    push(chunk: string) {
      if (!chunk) {
        return;
      }
      buffer += chunk;
      processBuffer(false);
    },
    finish() {
      processBuffer(true);
      return {
        lectureMarkdown: state.lectureMarkdown,
        memoryUpdate: state.memoryUpdate.trim(),
      };
    },
  };
}

function parseSseEvent(rawEvent: string) {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  return {
    eventName,
    data: dataLines.join("\n"),
  };
}

export function useLectureStream() {
  const streamLecture = useCallback(
    async (params: LectureStreamParams): Promise<XmlParserState> => {
      const parser = createXmlStreamParser({
        onLectureChunk: params.onLectureChunk,
        onMemoryChunk: params.onMemoryChunk,
      });

      const response = await fetch("/api/generate", {
        method: "POST",
        signal: params.signal,
        headers: {
          "Content-Type": "application/json",
          "x-lecturer-provider": params.provider.provider,
          "x-lecturer-api-key": params.provider.apiKey,
          "x-lecturer-base-url": params.provider.baseUrl,
          "x-lecturer-model": params.provider.model,
        },
        body: JSON.stringify(params.request),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Generation request failed (${response.status}): ${text.slice(0, 500)}`,
        );
      }

      if (!response.body) {
        throw new Error("Generation stream response body is empty.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleRawEvent = (rawEvent: string) => {
        const parsedEvent = parseSseEvent(rawEvent);

        if (parsedEvent.eventName === "token") {
          if (!parsedEvent.data) {
            return;
          }
          const data = JSON.parse(parsedEvent.data) as { delta?: string };
          if (typeof data.delta === "string") {
            parser.push(data.delta);
          }
          return;
        }

        if (parsedEvent.eventName === "error") {
          if (!parsedEvent.data) {
            throw new Error("Generation failed.");
          }
          const data = JSON.parse(parsedEvent.data) as { message?: string };
          throw new Error(data.message || "Generation failed.");
        }
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
          handleRawEvent(rawEvent);
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
        handleRawEvent(rawEvent);
      }
      if (buffer.trim()) {
        handleRawEvent(buffer);
      }

      return parser.finish();
    },
    [],
  );

  const extractTakeaway = useCallback(async (params: ExtractTakeawayParams) => {
    const response = await fetch("/api/takeaway", {
      method: "POST",
      signal: params.signal,
      headers: {
        "Content-Type": "application/json",
        "x-lecturer-provider": params.provider.provider,
        "x-lecturer-api-key": params.provider.apiKey,
        "x-lecturer-base-url": params.provider.baseUrl,
        "x-lecturer-model": params.provider.model,
      },
      body: JSON.stringify(params.request),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Takeaway request failed (${response.status}): ${text.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as { takeaway?: unknown };
    return normalizeSlideTakeaway(payload.takeaway, params.request.pageNumber);
  }, []);

  return {
    streamLecture,
    extractTakeaway,
  };
}
