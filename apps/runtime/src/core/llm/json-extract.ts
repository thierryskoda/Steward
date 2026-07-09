/**
 * Extracts a JSON object or array from raw LLM output (handles markdown fences and brace depth). Used by all structured agents to parse CLI stdout; use whenever agent output may be wrapped or malformed.
 * Only treats output as fenced when it starts with ``` so that JSON containing ``` inside string values (e.g. code examples in ruleContent) is extracted via brace-matching, not mistaken for a code block.
 */
export function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    const openMatch = trimmed.match(/^\s*```(?:json)?\s*\n?/);
    const afterOpen = openMatch ? trimmed.slice(openMatch[0].length) : trimmed.slice(3);
    const lastClose = afterOpen.lastIndexOf("```");
    if (lastClose >= 0) return afterOpen.slice(0, lastClose).trim();
  }
  const braceStart = trimmed.indexOf("{");
  if (braceStart < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    if (char !== "}") continue;
    depth--;
    if (depth === 0) return trimmed.slice(braceStart, i + 1);
  }
  return null;
}

export function extractJsonArray(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    const openMatch = trimmed.match(/^\s*```(?:json)?\s*\n?/);
    const afterOpen = openMatch ? trimmed.slice(openMatch[0].length) : trimmed.slice(3);
    const lastClose = afterOpen.lastIndexOf("```");
    if (lastClose >= 0) return afterOpen.slice(0, lastClose).trim();
  }
  const bracketStart = trimmed.indexOf("[");
  if (bracketStart < 0) return null;
  let depth = 0;
  let end = bracketStart;
  for (let i = bracketStart; i < trimmed.length; i++) {
    if (trimmed[i] === "[") depth++;
    if (trimmed[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return trimmed.slice(bracketStart, end);
}
