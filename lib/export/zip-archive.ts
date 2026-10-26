import { PassThrough } from "node:stream";
import { crc32 } from "node:zlib";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD = 0x06054b50;

type ZipEntry = {
  name: string;
  crc: number;
  size: number;
  offset: number;
};

/**
 * Streaming ZIP with STORE (no compression). Image payloads compress poorly,
 * and STORE avoids buffering an entire archive in memory.
 */
export class ZipStoreWriter {
  readonly stream = new PassThrough();
  private offset = 0;
  private readonly entries: ZipEntry[] = [];
  private finished = false;

  addFile(name: string, body: Buffer) {
    if (this.finished) {
      throw new Error("ZIP archive is already finished");
    }
    const filename = Buffer.from(name, "utf8");
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.byteLength, 18);
    local.writeUInt32LE(body.byteLength, 22);
    local.writeUInt16LE(filename.byteLength, 26);
    local.writeUInt16LE(0, 28);

    this.entries.push({ name, crc, size: body.byteLength, offset: this.offset });
    this.write(local);
    this.write(filename);
    this.write(body);
  }

  finish() {
    if (this.finished) {
      return;
    }
    this.finished = true;
    const centralStart = this.offset;
    for (const entry of this.entries) {
      const filename = Buffer.from(entry.name, "utf8");
      const header = Buffer.alloc(46);
      header.writeUInt32LE(CENTRAL_HEADER, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(0, 12);
      header.writeUInt16LE(0, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.size, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(filename.byteLength, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE(0, 38);
      header.writeUInt32LE(entry.offset, 42);
      this.write(header);
      this.write(filename);
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(this.offset - centralStart, 12);
    eocd.writeUInt32LE(centralStart, 16);
    eocd.writeUInt16LE(0, 20);
    this.write(eocd);
    this.stream.end();
  }

  fail(error: unknown) {
    if (!this.finished) {
      this.finished = true;
      this.stream.destroy(error instanceof Error ? error : new Error("ZIP export failed"));
    }
  }

  private write(chunk: Buffer) {
    this.offset += chunk.byteLength;
    this.stream.write(chunk);
  }
}
