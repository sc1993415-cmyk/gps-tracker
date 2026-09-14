/**
 * MT909 / H02 companion LBS frame (41B, no 0x24 marker).
 *
 * Sample (log truncated to 24B / 48 hex — trailing 17B unknown, DO NOT invent):
 *   hex visible: 0001cc00500b000013000000000000000000000000000000
 *   bytes:       00 01 cc 00 50 0b 00 00 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
 *
 * Field table (primary mapping used in parseLbs):
 * | field | offset | len | endian | sample decode        | notes |
 * |-------|--------|-----|--------|----------------------|-------|
 * | hdr   | 0      | 1   | —      | 0x00                 | unknown type/flags; TODO |
 * | mcc   | 1      | 2   | BE     | 0x01CC = 460         | China; confirmed |
 * | mnc   | 3      | 1   | —      | 0x00 = 0             | alt: uint16BE@3 = 0x0050 |
 * | lac   | 4      | 2   | BE     | 0x500B = 20491       | alt: LE @4 |
 * | ci    | 6      | 4   | BE     | 0x00001300 = 4864    | alt: BE u16@8=0x1300; LE u32@6 |
 * | rssi  | ?      | ?   | ?      | TODO                 | needs full 41B hex |
 * | rest  | 10..40 | —   | —      | TODO                 | truncated in journal |
 */

export const LBS_FRAME_LEN = 41;
/** MT909 binary Normal Data: offsets 0x00..0x48 inclusive. */
export const MT909_BINARY_LEN = 73;
/** China MCC — signature used to recognize LBS without 0x24. */
export const LBS_MCC_CN = 460;

export type LbsCell = {
  mcc?: number;
  mnc?: number;
  lac?: number;
  ci?: number;
  /** RSSI / rxlev if known. */
  rssi?: number;
  rawHex: string;
  /** True when frame was shorter than 41 in tests / truncated logs. */
  truncated: boolean;
  neighbors?: { lac: number; ci: number; rx?: number }[];
};

export function fullHex(buf: Buffer): string {
  return buf.toString("hex");
}

/** True if buffer looks like the observed 41B LBS prefix (MCC 460). */
export function looksLikeLbs(buf: Buffer): boolean {
  if (buf.length < 3) return false;
  // Primary: MCC at offset 1 (sample 00 01 cc …)
  if (buf.length >= 3 && buf.readUInt16BE(1) === LBS_MCC_CN) return true;
  // Alternate: MCC at offset 0
  if (buf.readUInt16BE(0) === LBS_MCC_CN) return true;
  return false;
}

/**
 * Parse one LBS frame. Prefer full 41B; still parse visible prefix if shorter
 * (unit tests may pad truncated journal hex with zeros — mark truncated).
 */
export function parseLbs(buf: Buffer): LbsCell | null {
  if (buf.length < 10) return null;
  if (!looksLikeLbs(buf)) return null;

  const truncated = buf.length < LBS_FRAME_LEN;
  const rawHex = fullHex(buf);

  // --- primary mapping (see file header table) ---
  let mcc: number | undefined;
  let mnc: number | undefined;
  let lac: number | undefined;
  let ci: number | undefined;

  if (buf.readUInt16BE(1) === LBS_MCC_CN) {
    mcc = LBS_MCC_CN;
    mnc = buf[3]!;
    lac = buf.readUInt16BE(4);
    ci = buf.readUInt32BE(6);
    // Alternates (kept for future full-hex validation):
    // mnc = buf.readUInt16BE(3); // → 0x0050 on sample
    // lac = buf.readUInt16LE(4);
    // ci = buf.readUInt32LE(6);
    // ci = buf.readUInt16BE(8);
  } else if (buf.readUInt16BE(0) === LBS_MCC_CN) {
    // Alternate head without leading hdr byte
    mcc = LBS_MCC_CN;
    mnc = buf[2]!;
    lac = buf.readUInt16BE(3);
    ci = buf.length >= 9 ? buf.readUInt32BE(5) : undefined;
  }

  // rssi: TODO — offsets 10..40 unknown until full 41B hex is logged

  return { mcc, mnc, lac, ci, rawHex, truncated };
}


/** True when buffer is a full MT909 73B record (\$ + MCC 460 at 0x21). */
export function looksLikeMt909Binary(buf: Buffer): boolean {
  if (buf.length < MT909_BINARY_LEN) return false;
  if (buf[0] !== 0x24) return false;
  return buf.readUInt16BE(0x21) === LBS_MCC_CN;
}

/**
 * Serving + neighbor cells from official MT909 Normal Data offsets:
 *   0x21-0x22 MCC, 0x23 MNC, 0x24-0x25 LAC, 0x26-0x27 CI (u16 BE), 0x28 RX
 *   0x29-0x2C / 0x2E-0x32 neighbor LAC+CI+RX
 */
export function parseMt909ServingCell(buf: Buffer): LbsCell | null {
  if (buf.length < 0x29 || buf[0] !== 0x24) return null;
  const mcc = buf.readUInt16BE(0x21);
  const mnc = buf[0x23]!;
  const lac = buf.readUInt16BE(0x24);
  let ci = buf.readUInt16BE(0x26);
  const rssi = buf[0x28]!;
  const neighbors: { lac: number; ci: number; rx?: number }[] = [];
  if (buf.length >= 0x2e) {
    neighbors.push({ lac: buf.readUInt16BE(0x29), ci: buf.readUInt16BE(0x2b), rx: buf[0x2d] });
  }
  if (buf.length >= 0x33) {
    neighbors.push({ lac: buf.readUInt16BE(0x2e), ci: buf.readUInt16BE(0x30), rx: buf[0x32] });
  }
  if (!ci) {
    const n = neighbors.find((x) => x.ci);
    if (n) {
      ci = n.ci;
    }
  }
  return {
    mcc,
    mnc,
    lac,
    ci,
    rssi,
    neighbors,
    rawHex: fullHex(buf),
    truncated: buf.length < MT909_BINARY_LEN,
  };
}
