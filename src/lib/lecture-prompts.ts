export interface SlideTakeaway {
  slide_number: number;
  core_concept: string;
  introduced_notation: string[];
  key_equations: string[];
}

interface MainGenerationPromptParams {
  pageNumber: number;
  availableTakeaways: SlideTakeaway[];
  previousPageMarkdown: string;
  outputLanguage: string;
  customPrompt: string;
}

const DEFAULT_OUTPUT_LANGUAGE = "English";

export const TAKEAWAY_EXTRACTOR_PROMPT =
  'Analyze the provided slide text and extract its core structural information. Output strictly as JSON: { "slide_number": <int>, "core_concept": "<maximum 3 sentences summary>", "introduced_notation": ["<symbol>: <definition>"], "key_equations": ["<equation>"] }';

const PEDAGOGY_AND_DEPTH_PROMPT = `
CRITICAL INSTRUCTIONS FOR PEDAGOGY & DEPTH (STRICT):
1. ANTI-PARROTING: Cover ALL the content, but Do NOT just read the slide text out loud. Synthesize and abbreviate the text blocks into a conversational but dense academic explanation.
2. MANDATORY MATH WALKTHROUGH: You MUST explain at least the core steps of EVERY formula or derivation present on the slide. Define the key variables and explain the intuition behind the math. Do not skip or gloss over the mathematics.
3. VISUAL GROUNDING: You MUST explicitly analyze and incorporate any charts, graphs, diagrams, or architecture figures on the slide into your lecture. Reference them directly in your prose (e.g., "As illustrated in the graph on the right, the curve indicates...", "Notice the architecture diagram here, where component X connects to Y...").
4. VISUAL HIERARCHY & CUES: You MUST actively interpret the spatial layout and typographical cues on the slide.
   - Positioning: Content placed at the top, center, or in larger font is likely more important. If the slide has a title, it often encapsulates the main theme.
   - Punctuation Intent: Pay close attention to punctuations such as '?' and '!'. e.g. A question mark ('?') often indicates a core problem statement, a gap in knowledge, or a rhetorical question - you MUST frame your explanation by posing this question to the audience before answering it. An exclamation mark ('!') indicates a critical pitfall, a surprising breakthrough, or a strict rule - you MUST emphasize this with a strong warning or assertion.
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

const NARRATIVE_FLOW_PROMPT = `
CRITICAL INSTRUCTIONS FOR NARRATIVE FLOW (STRICT):
1. Get straight to the technical point of the current slide immediately.
2. You have been provided with 'Available Takeaways' and 'Previous Slide'. Use this ONLY to ensure your mathematical and logical definitions are consistent with what you said before. DO NOT explicitly repeat or summarize the previous context in your output unless it is necessary.
3. Explain the current slide as if it is a seamless continuation of the previous paragraph.
`;

export function buildEmptyTakeaway(slideNumber: number): SlideTakeaway {
  return {
    slide_number: slideNumber,
    core_concept: "",
    introduced_notation: [],
    key_equations: [],
  };
}

function sanitizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeSlideTakeaway(
  value: unknown,
  fallbackSlideNumber: number,
): SlideTakeaway {
  if (!value || typeof value !== "object") {
    return buildEmptyTakeaway(fallbackSlideNumber);
  }

  const candidate = value as Partial<SlideTakeaway>;
  const parsedSlideNumber =
    typeof candidate.slide_number === "number" &&
      Number.isFinite(candidate.slide_number) &&
      candidate.slide_number >= 1
      ? Math.floor(candidate.slide_number)
      : fallbackSlideNumber;

  const coreConcept =
    typeof candidate.core_concept === "string"
      ? candidate.core_concept.trim()
      : "";

  return {
    slide_number: parsedSlideNumber,
    core_concept: coreConcept,
    introduced_notation: sanitizeStringArray(candidate.introduced_notation),
    key_equations: sanitizeStringArray(candidate.key_equations),
  };
}

export function buildMainGenerationSystemPrompt(
  params: MainGenerationPromptParams,
) {
  const outputLanguage = params.outputLanguage.trim() || DEFAULT_OUTPUT_LANGUAGE;
  const customPrompt = params.customPrompt.trim() || "(none)";
  const previousPageMarkdown = params.previousPageMarkdown.trim() || "(none)";
  const availableTakeaways = JSON.stringify(params.availableTakeaways, null, 2);

  return `You are a rigorous Academic Teaching Assistant generating comprehensive lecture notes for Slide ${params.pageNumber}. Explain derivations clearly using LaTeX. You will be provided with the markdown of the PREVIOUS slide (Slide N-1). You must smoothly continue the logical flow. Do not hallucinate missing links.

${NARRATIVE_FLOW_PROMPT}

${PEDAGOGY_AND_DEPTH_PROMPT}

${TRUTH_AND_GROUNDING_PROMPT}

CONTEXT: LECTURE CONCEPTUAL MAP
You are currently generating Slide ${params.pageNumber}. Below is the conceptual map of the lecture available up to this point.
- Use the past takeaways to ensure your notation aligns perfectly with established definitions.
- If future takeaways are available in this map, use them to foreshadow upcoming derivations.

<Available_Takeaways>
${availableTakeaways}
</Available_Takeaways>

<Immediate_Previous_Slide_Markdown>
${previousPageMarkdown}
</Immediate_Previous_Slide_Markdown>

OUTPUT LANGUAGE: ${outputLanguage}
CUSTOM INSTRUCTIONS: ${customPrompt}

Return output strictly in this XML format:
<lecture>
[Markdown lecture text in ${outputLanguage}. Use $$ for block math and $ for inline math.]
</lecture>
<memory_update>
[Extract 1 to 3 concise technical takeaways in ${outputLanguage}. Strict max 50 words.]
</memory_update>`;
}
