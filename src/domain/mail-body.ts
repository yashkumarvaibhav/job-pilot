export type InboundMailBody = {
  contentType: string;
  body: string;
};

const BLOCK_TAGS =
  /<\/?(?:address|article|aside|blockquote|div|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
const LINE_BREAKS = /<br\s*\/?\s*>/gi;
const RAW_CONTENT = /<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const TAGS = /<[^>]*>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodedCodePoint(value: number): string | null {
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > 0x10ffff ||
    (value >= 0xd800 && value <= 0xdfff)
  ) {
    return null;
  }
  return String.fromCodePoint(value);
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi,
    (entity, key: string) => {
      if (key.startsWith("#x") || key.startsWith("#X")) {
        return decodedCodePoint(Number.parseInt(key.slice(2), 16)) ?? entity;
      }
      if (key.startsWith("#")) {
        return decodedCodePoint(Number.parseInt(key.slice(1), 10)) ?? entity;
      }
      return NAMED_ENTITIES[key.toLowerCase()] ?? entity;
    },
  );
}

function htmlToVisibleText(value: string): string {
  return decodeEntities(
    value
      .replace(COMMENTS, "")
      .replace(RAW_CONTENT, "")
      .replace(LINE_BREAKS, "\n")
      .replace(BLOCK_TAGS, "\n")
      .replace(TAGS, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t\f\v ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

/**
 * The only accepted boundary for a future inbound message body. Callers get a
 * string for ordinary text rendering; no markup representation leaves here.
 */
export function inboundMailBodyText(input: InboundMailBody): string {
  const contentType = input.contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType === "text/plain") {
    return input.body;
  }
  if (contentType === "text/html") {
    return htmlToVisibleText(input.body);
  }
  return "";
}
