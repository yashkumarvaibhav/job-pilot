/**
 * QR Code Model 2 byte-mode encoder for the bounded authenticator URI surface.
 * It uses error-correction level M and versions 1–10; Job Pilot's generated
 * otpauth URIs fit this range, including the longest permitted new username.
 */

type BlockGroup = readonly [count: number, totalCodewords: number, dataCodewords: number];

const MEDIUM_BLOCKS: readonly (readonly BlockGroup[])[] = [
  [[1, 26, 16]],
  [[1, 44, 28]],
  [[1, 70, 44]],
  [[2, 50, 32]],
  [[2, 67, 43]],
  [[4, 43, 27]],
  [[4, 49, 31]],
  [[2, 60, 38], [2, 61, 39]],
  [[3, 58, 36], [2, 59, 37]],
  [[4, 69, 43], [1, 70, 44]],
];

const BYTE_MODE = 0b0100;
const PAD_CODEWORDS = [0xec, 0x11] as const;

function appendBits(target: number[], value: number, length: number) {
  for (let bit = length - 1; bit >= 0; bit -= 1) {
    target.push((value >>> bit) & 1);
  }
}

function dataCapacity(version: number): number {
  return MEDIUM_BLOCKS[version - 1].reduce(
    (total, [count, , data]) => total + count * data,
    0,
  );
}

function encodeData(text: string, version: number): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const capacityBits = dataCapacity(version) * 8;
  const countBits = version < 10 ? 8 : 16;
  const bits: number[] = [];

  appendBits(bits, BYTE_MODE, 4);
  appendBits(bits, bytes.length, countBits);
  for (const byte of bytes) appendBits(bits, byte, 8);
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const result = new Uint8Array(dataCapacity(version));
  let used = 0;
  for (; used < bits.length / 8; used += 1) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value << 1) | bits[used * 8 + bit];
    }
    result[used] = value;
  }
  for (; used < result.length; used += 1) {
    result[used] = PAD_CODEWORDS[(used - bits.length / 8) % 2];
  }
  return result;
}

function multiply(a: number, b: number): number {
  let result = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((b >>> bit) & 1) * a;
  }
  return result;
}

function reedSolomonDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let term = 0; term < degree; term += 1) {
      result[term] = multiply(result[term], root);
      if (term + 1 < degree) result[term] ^= result[term + 1];
    }
    root = multiply(root, 2);
  }
  return result;
}

function reedSolomonRemainder(
  data: Uint8Array,
  divisor: Uint8Array,
): Uint8Array {
  const result = new Uint8Array(divisor.length);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let index = 0; index < divisor.length; index += 1) {
      result[index] ^= multiply(divisor[index], factor);
    }
  }
  return result;
}

function interleaveWithCorrection(
  data: Uint8Array,
  version: number,
): Uint8Array {
  const groups = MEDIUM_BLOCKS[version - 1];
  const blocks: { data: Uint8Array; correction: Uint8Array }[] = [];
  let offset = 0;
  for (const [count, totalCount, dataCount] of groups) {
    const divisor = reedSolomonDivisor(totalCount - dataCount);
    for (let block = 0; block < count; block += 1) {
      const slice = data.slice(offset, offset + dataCount);
      blocks.push({ data: slice, correction: reedSolomonRemainder(slice, divisor) });
      offset += dataCount;
    }
  }

  const result: number[] = [];
  const longestData = Math.max(...blocks.map((block) => block.data.length));
  for (let index = 0; index < longestData; index += 1) {
    for (const block of blocks) {
      if (index < block.data.length) result.push(block.data[index]);
    }
  }
  for (let index = 0; index < blocks[0].correction.length; index += 1) {
    for (const block of blocks) result.push(block.correction[index]);
  }
  return Uint8Array.from(result);
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32
    ? 26
    : Math.ceil((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) {
    result.splice(1, 0, position);
  }
  return result;
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    default: throw new Error("Invalid QR mask.");
  }
}

class QrMatrixBuilder {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly functions: boolean[][];

  constructor(readonly version: number, codewords: Uint8Array) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      Array<boolean>(this.size).fill(false));
    this.functions = Array.from({ length: this.size }, () =>
      Array<boolean>(this.size).fill(false));
    this.drawFunctionPatterns();
    this.drawCodewords(codewords);
  }

  private setFunction(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.functions[y][x] = true;
  }

  private drawFinder(centerX: number, centerY: number) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFunction(x, y, distance !== 2 && distance !== 4);
      }
    }
  }

  private drawAlignment(centerX: number, centerY: number) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        this.setFunction(
          centerX + dx,
          centerY + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
        );
      }
    }
  }

  private drawFunctionPatterns() {
    for (let index = 0; index < this.size; index += 1) {
      this.setFunction(6, index, index % 2 === 0);
      this.setFunction(index, 6, index % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);

    const positions = alignmentPositions(this.version);
    const last = positions.length - 1;
    for (let row = 0; row < positions.length; row += 1) {
      for (let column = 0; column < positions.length; column += 1) {
        if (
          (row === 0 && column === 0) ||
          (row === 0 && column === last) ||
          (row === last && column === 0)
        ) continue;
        this.drawAlignment(positions[column], positions[row]);
      }
    }
    this.drawFormatBits(0);
    this.drawVersionBits();
  }

  private drawFormatBits(mask: number) {
    const data = mask; // Error-correction level M has format bits 00.
    let remainder = data;
    for (let index = 0; index < 10; index += 1) {
      remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    }
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const bit = (index: number) => ((bits >>> index) & 1) !== 0;

    for (let index = 0; index <= 5; index += 1) this.setFunction(8, index, bit(index));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let index = 9; index < 15; index += 1) {
      this.setFunction(14 - index, 8, bit(index));
    }
    for (let index = 0; index < 8; index += 1) {
      this.setFunction(this.size - 1 - index, 8, bit(index));
    }
    for (let index = 8; index < 15; index += 1) {
      this.setFunction(8, this.size - 15 + index, bit(index));
    }
    this.setFunction(8, this.size - 8, true);
  }

  private drawVersionBits() {
    if (this.version < 7) return;
    let remainder = this.version;
    for (let index = 0; index < 12; index += 1) {
      remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    }
    const bits = (this.version << 12) | remainder;
    for (let index = 0; index < 18; index += 1) {
      const dark = ((bits >>> index) & 1) !== 0;
      const a = this.size - 11 + (index % 3);
      const b = Math.floor(index / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  private drawCodewords(codewords: Uint8Array) {
    let bitIndex = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < this.size; vertical += 1) {
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? this.size - 1 - vertical : vertical;
        for (let offset = 0; offset < 2; offset += 1) {
          const x = right - offset;
          if (this.functions[y][x] || bitIndex >= codewords.length * 8) continue;
          this.modules[y][x] =
            ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex += 1;
        }
      }
    }
    if (bitIndex !== codewords.length * 8) throw new Error("QR data placement failed.");
  }

  private applyMask(mask: number) {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        if (!this.functions[y][x] && maskApplies(mask, x, y)) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  }

  private penalty(): number {
    let score = 0;
    const lines = [
      ...this.modules,
      ...Array.from({ length: this.size }, (_, x) =>
        this.modules.map((row) => row[x])),
    ];

    for (const line of lines) {
      let runLength = 1;
      for (let index = 1; index < line.length; index += 1) {
        if (line[index] === line[index - 1]) {
          runLength += 1;
          if (runLength === 5) score += 3;
          else if (runLength > 5) score += 1;
        } else {
          runLength = 1;
        }
      }
      for (let index = 0; index <= line.length - 7; index += 1) {
        const finderLike =
          line[index] && !line[index + 1] && line[index + 2] &&
          line[index + 3] && line[index + 4] && !line[index + 5] &&
          line[index + 6];
        if (!finderLike) continue;
        const before = index >= 4 && line.slice(index - 4, index).every((item) => !item);
        const after = index + 11 <= line.length &&
          line.slice(index + 7, index + 11).every((item) => !item);
        if (before) score += 40;
        if (after) score += 40;
      }
    }

    for (let y = 0; y < this.size - 1; y += 1) {
      for (let x = 0; x < this.size - 1; x += 1) {
        const value = this.modules[y][x];
        if (
          this.modules[y][x + 1] === value &&
          this.modules[y + 1][x] === value &&
          this.modules[y + 1][x + 1] === value
        ) score += 3;
      }
    }

    const dark = this.modules.reduce(
      (total, row) => total + row.filter(Boolean).length,
      0,
    );
    const modules = this.size * this.size;
    score += Math.floor(Math.abs(dark * 20 - modules * 10) / modules) * 10;
    return score;
  }

  finish(): boolean[][] {
    let bestMask = 0;
    let bestPenalty = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask += 1) {
      this.applyMask(mask);
      this.drawFormatBits(mask);
      const score = this.penalty();
      if (score < bestPenalty) {
        bestPenalty = score;
        bestMask = mask;
      }
      this.applyMask(mask);
    }
    this.applyMask(bestMask);
    this.drawFormatBits(bestMask);
    return this.modules.map((row) => [...row]);
  }
}

export function encodeQrCode(text: string): boolean[][] {
  const byteLength = new TextEncoder().encode(text).length;
  const version = MEDIUM_BLOCKS.findIndex((_, index) => {
    const currentVersion = index + 1;
    const countBits = currentVersion < 10 ? 8 : 16;
    return 4 + countBits + byteLength * 8 <= dataCapacity(currentVersion) * 8;
  }) + 1;
  if (version === 0) throw new Error("QR code content is too long.");

  const data = encodeData(text, version);
  return new QrMatrixBuilder(
    version,
    interleaveWithCorrection(data, version),
  ).finish();
}
