/**
 * Camera frame -> tf.Tensor3D conversion, fully on-device.
 *
 * The camera captures at full sensor resolution (e.g. 1740x2320). Decoding and
 * tensorising a frame that large in pure JS takes tens of seconds on a phone,
 * so we FIRST downscale the JPEG with Expo's native image manipulator (longest
 * edge <= CONFIG.inferenceMaxSize). Only the small image is ever decoded with
 * `jpeg-js` and turned into an int32 RGB tensor, keeping CPU inference
 * responsive on mid-range devices.
 */
import { decode as decodeJpeg } from 'jpeg-js';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { CONFIG } from '../config';
import { tf } from './faceEngine';

/**
 * Natively resize the captured JPEG so its longest edge is <= inferenceMaxSize,
 * returning the new file uri. We pass only one dimension to `resize` so the
 * other is computed to preserve aspect ratio. Portrait captures (height >=
 * width, the common case) constrain height; landscape constrains width.
 */
async function resizeForInference(uri: string): Promise<string> {
  const max = CONFIG.inferenceMaxSize;
  const ctx = ImageManipulator.manipulate(uri);
  // We don't know the source dimensions here without decoding, so resize by the
  // dimension that is the longest in a typical front-camera portrait. Capping
  // height to `max` makes the longest edge <= max for portrait frames; the
  // width is auto-derived. For landscape this still produces a small image.
  ctx.resize({ height: max });
  const rendered = await ctx.renderAsync();
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: CONFIG.captureQuality,
  });
  return result.uri;
}

/**
 * Decode a captured photo (file:// uri) into an RGB Tensor3D [h, w, 3], int32.
 * Caller owns the returned tensor and must `.dispose()` it when done.
 */
export async function uriToTensor(uri: string): Promise<any> {
  const original = new File(uri);

  // 1. Downscale natively before any JS-side decode.
  const tResize = Date.now();
  const smallUri = await resizeForInference(uri);
  console.log('[image] native resize in', Date.now() - tResize, 'ms');
  // The original full-res capture is no longer needed.
  try {
    original.delete();
  } catch {
    /* best-effort cleanup */
  }

  const small = new File(smallUri);
  const tRead = Date.now();
  const bytes = await small.bytes();
  console.log('[image] read', bytes.length, 'bytes in', Date.now() - tRead, 'ms');
  try {
    small.delete();
  } catch {
    /* best-effort cleanup */
  }

  const tDec = Date.now();
  const { width, height, data } = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true });
  console.log('[image] decoded jpeg', width, 'x', height, 'in', Date.now() - tDec, 'ms');

  // Pack RGB directly into a tightly-sized Int32Array, dropping the alpha
  // channel in the same pass. This avoids building a [h,w,4] int32 tensor and
  // then running a `.slice()` op to strip alpha — the old approach allocated
  // ~33% more memory and ran an extra CPU kernel. One tensor, no slice.
  const tTen = Date.now();
  const px = width * height;
  const rgb = new Int32Array(px * 3);
  for (let i = 0, j = 0; i < px; i++) {
    const k = i << 2; // i * 4 — source RGBA offset
    rgb[j++] = data[k];
    rgb[j++] = data[k + 1];
    rgb[j++] = data[k + 2];
  }
  // The image was already capped to inferenceMaxSize by the native resize, so
  // no further (expensive) in-JS resizeBilinear is needed.
  const out = tf.tensor3d(rgb, [height, width, 3], 'int32');
  console.log('[image] tensor built in', Date.now() - tTen, 'ms, shape', out.shape);
  return out;
}
