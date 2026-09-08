import {MAX_FILE_BYTES, PhotoError} from './capability.js';

const invalid = () => new PhotoError('format', 'Choose a JPEG, PNG or WebP photo. For HEIC, video or other formats, try the app.');
const text = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));

export function parseImageHeader(buffer) {
  const b = new Uint8Array(buffer);
  const v = new DataView(buffer);
  if (b.length >= 24 && b[0] === 137 && text(b, 1, 7) === 'PNG\r\n\x1a\n' && text(b, 12, 4) === 'IHDR') {
    for (let p = 8; p + 12 <= b.length;) {
      const type = text(b, p + 4, 4);
      if (type === 'acTL') throw new PhotoError('format', 'Animated images aren’t supported in this photo preview. Choose a still photo.');
      if (type === 'IDAT') break;
      const length = v.getUint32(p);
      p += length + 12;
    }
    return {width: v.getUint32(16), height: v.getUint32(20), format: 'png'};
  }
  if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    let dimensions;
    let orientation = 1;
    for (let p = 2; p + 4 <= b.length;) {
      if (b[p++] !== 255) throw invalid();
      while (b[p] === 255) p++;
      const marker = b[p++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (p + 2 > b.length) break;
      const length = v.getUint16(p);
      if (length < 2 || p + length > b.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        dimensions = {height: v.getUint16(p + 3), width: v.getUint16(p + 5), format: 'jpeg'};
      }
      if (marker === 225 && length >= 16 && text(b, p + 2, 6) === 'Exif\0\0') {
        const tiff = p + 8;
        const little = text(b, tiff, 2) === 'II';
        const directory = tiff + v.getUint32(tiff + 4, little);
        if (directory >= tiff && directory + 2 <= p + length) {
          const count = v.getUint16(directory, little);
          for (let i = 0; i < count; i++) {
            const entry = directory + 2 + i * 12;
            if (entry + 12 > p + length) break;
            if (v.getUint16(entry, little) === 0x112 && v.getUint16(entry + 2, little) === 3 && v.getUint32(entry + 4, little) === 1) {
              orientation = v.getUint16(entry + 8, little);
            }
          }
        }
      }
      p += length;
    }
    if (dimensions) {
      if (orientation >= 5 && orientation <= 8) [dimensions.width, dimensions.height] = [dimensions.height, dimensions.width];
      return dimensions;
    }
  }
  if (b.length >= 30 && text(b, 0, 4) === 'RIFF' && text(b, 8, 4) === 'WEBP') {
    const u24 = p => b[p] + b[p + 1] * 256 + b[p + 2] * 65536;
    const type = text(b, 12, 4);
    if (type === 'VP8X') {
      if (b[20] & 2) throw new PhotoError('format', 'Animated images aren’t supported in this photo preview. Choose a still photo.');
      return {width: u24(24) + 1, height: u24(27) + 1, format: 'webp'};
    }
    if (type === 'VP8 ' && b[23] === 157 && b[24] === 1 && b[25] === 42) {
      return {width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff, format: 'webp'};
    }
    if (type === 'VP8L' && b[20] === 47) {
      return {width: 1 + b[21] + ((b[22] & 63) << 8),
        height: 1 + ((b[22] & 192) >> 6) + (b[23] << 2) + ((b[24] & 15) << 10), format: 'webp'};
    }
  }
  throw invalid();
}

export async function inspectFile(file) {
  if (!file || !file.size) throw invalid();
  if (file.size > MAX_FILE_BYTES) throw new PhotoError('size', 'This file exceeds the browser preview’s 50 MB limit. Try it in the app.');
  // Metadata only. Reject an unreadable header rather than decoding an image
  // with unknown dimensions. File bytes never leave the worker.
  return {...parseImageHeader(await file.slice(0, 2 * 1024 * 1024).arrayBuffer()), size: file.size};
}
