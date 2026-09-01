export type CsvRow = {
  line: number;
  values: string[];
};

export type CsvDocument = {
  headers: string[];
  rows: CsvRow[];
};

export class CsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvImportError";
  }
}

/** RFC 4180-shaped parser with source lines retained for user-facing reports. */
export function parseCsv(source: string): CsvDocument {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const records: CsvRow[] = [];
  let values: string[] = [];
  let value = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;

  function finishValue() {
    values.push(value);
    value = "";
    afterQuote = false;
  }

  function finishRecord() {
    finishValue();
    if (values.some((cell) => cell.length > 0)) {
      records.push({ line: recordLine, values });
    }
    values = [];
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        value += character;
        if (character === "\n") line += 1;
      }
      continue;
    }

    if (afterQuote && character !== "," && character !== "\n" && character !== "\r") {
      throw new CsvImportError(`Unexpected text after a quoted field on line ${line}.`);
    }
    if (character === '"') {
      if (value.length > 0) {
        throw new CsvImportError(`Unexpected quote on line ${line}.`);
      }
      quoted = true;
    } else if (character === ",") {
      finishValue();
    } else if (character === "\n" || character === "\r") {
      finishRecord();
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      line += 1;
      recordLine = line;
    } else {
      value += character;
    }
  }

  if (quoted) {
    throw new CsvImportError(`Unclosed quoted field on line ${recordLine}.`);
  }
  if (value.length > 0 || values.length > 0) finishRecord();
  if (records.length === 0) {
    throw new CsvImportError("CSV must contain a header row.");
  }

  const [header, ...rows] = records;
  const headers = header.values.map((cell) => cell.trim());
  if (headers.some((cell) => cell.length === 0)) {
    throw new CsvImportError("CSV headers cannot be blank.");
  }
  if (new Set(headers).size !== headers.length) {
    throw new CsvImportError("CSV headers must be unique.");
  }
  return { headers, rows };
}
