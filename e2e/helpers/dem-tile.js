// @ts-check
/**
 * A flat elevation tile, built in memory — for the specs that need a `raster-dem` source
 * answered from the same origin, so that no third party decides their verdict.
 *
 * ⚠️ FLAT MEANS NO RELIEF. A terrain draped over it stays level and a hillshade layer reading it
 * draws no shading: such a tile proves that a source exists, is requested and is read, never
 * what the engine renders from it.
 */
import { deflateSync, crc32 } from "node:zlib";

/** A PNG chunk: length, type, data, CRC over type and data. */
function pngChunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

/**
 * A flat 256 px elevation tile: Terrarium encodes sea level as RGB (128, 0, 0).
 *
 * @returns {Buffer} The PNG, ready for `route.fulfill({ contentType: "image/png", body })`.
 */
export function flatDemTile() {
    const size = 256;
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour, no interlace
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) row[1 + x * 3] = 128;
    const pixels = Buffer.concat(Array.from({ length: size }, () => row));
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(pixels)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}
