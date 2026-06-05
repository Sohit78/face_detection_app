/**
 * Offline face engine built on @vladmandic/face-api.
 *
 * Responsibilities:
 *  - Initialise TensorFlow.js (CPU backend — pure JS, runs inside Expo Go with
 *    no native modules).
 *  - Load the four model nets from **bundled** weights (no network).
 *  - Run detection + 68 landmarks + expressions (+ optional 128-d descriptor)
 *    on a captured frame.
 *
 * All inference is fed a `tf.Tensor3D`, so face-api never touches the DOM
 * (canvas/Image), which is what makes it work in React Native.
 */
import * as faceapi from '@vladmandic/face-api';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { CONFIG } from '../config';
import { MODELS, BundledModel, NetName } from './modelAssets';

// Use the tfjs instance bundled inside face-api (avoids a second tfjs copy at
// runtime). The `typeof import(...)` is a type-only reference for editor types
// and is erased at build time, so the standalone tfjs is never bundled.
export const tf = faceapi.tf as unknown as typeof import('@tensorflow/tfjs');

let _status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let _error: string | null = null;
let _initPromise: Promise<void> | null = null;

export function getEngineStatus() {
  return { status: _status, error: _error };
}

/**
 * React Native has no DOM. We always feed tensors so canvas/Image are never
 * actually used, but face-api's `env` must exist — provide harmless stubs and
 * make the DOM-only factories throw loudly if ever hit.
 */
function setupEnv() {
  try {
    // face-api auto-initialises its env only for browser or node. In React
    // Native it detects neither, so `monkeyPatch` (which calls getEnv) throws
    // "environment is not defined". We must SET a complete Environment instead.
    // We always feed tensors, so the DOM/file factories are never actually hit.
    const StubCanvas = class {} as any;
    const StubImage = class {} as any;
    const die = (what: string) => () => {
      throw new Error(`${what} unsupported in React Native — feed a tf.Tensor3D instead`);
    };
    faceapi.env.setEnv({
      Canvas: StubCanvas,
      CanvasRenderingContext2D: class {} as any,
      Image: StubImage,
      ImageData: class {} as any,
      Video: class {} as any,
      createCanvasElement: die('canvas'),
      createImageElement: die('image element'),
      createVideoElement: die('video element'),
      fetch: (globalThis as any).fetch?.bind(globalThis),
      readFile: die('readFile'),
    } as any);
    console.log('[faceEngine] face-api env set for React Native');
  } catch (e) {
    console.warn('[faceEngine] setupEnv failed:', e);
  }
}

// --- Minimal UTF-8 codec (TextEncoder/Decoder isn't guaranteed in Hermes) ---
function encodeString(text: string): Uint8Array {
  const g: any = globalThis as any;
  if (typeof g.TextEncoder !== 'undefined') return new g.TextEncoder().encode(text);
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0xd800 || code >= 0xe000)
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else {
      const code2 = text.charCodeAt(++i);
      const c = 0x10000 + (((code & 0x3ff) << 10) | (code2 & 0x3ff));
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

function decodeString(bytes: Uint8Array, encoding = 'utf-8'): string {
  const g: any = globalThis as any;
  if (typeof g.TextDecoder !== 'undefined') return new g.TextDecoder(encoding).decode(bytes);
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i++];
    if (b1 < 0x80) out += String.fromCharCode(b1);
    else if (b1 < 0xe0) out += String.fromCharCode(((b1 & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b1 < 0xf0)
      out += String.fromCharCode(
        ((b1 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f),
      );
    else {
      let c =
        ((b1 & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
      c -= 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    }
  }
  return out;
}

/**
 * TensorFlow.js delegates `isTypedArray`, `now`, `encode`/`decode` and `fetch`
 * to a registered Platform. Browser/Node auto-register one; React Native does
 * not, leaving `env().platform` undefined (→ "Cannot read property 'isTypedArray'
 * of undefined"). Register a minimal RN platform before any tf op.
 */
function ensurePlatform(): void {
  try {
    const e: any = (tf as any).env?.();
    if (!e || (e.platform && typeof e.platform.isTypedArray === 'function')) return;
    const platform = {
      fetch: (path: string, init?: any) => (globalThis as any).fetch(path, init),
      now: () => Date.now(),
      encode: (text: string) => encodeString(text),
      decode: (bytes: Uint8Array, encoding?: string) => decodeString(bytes, encoding),
      isTypedArray: (a: any) =>
        a instanceof Float32Array ||
        a instanceof Int32Array ||
        a instanceof Uint8Array ||
        a instanceof Uint8ClampedArray,
    };
    if (typeof e.setPlatform === 'function') e.setPlatform('react-native', platform);
  } catch {
    // ignore — surfaced downstream if truly broken
  }
}

/** Read a bundled .bin asset into a tightly-sized ArrayBuffer. */
async function readBin(binModule: number): Promise<ArrayBuffer> {
  const asset = Asset.fromModule(binModule);
  if (!asset.downloaded) {
    await asset.downloadAsync();
  }
  const uri = asset.localUri ?? asset.uri;
  // SDK 56 file API: returns a Uint8Array view over the file bytes.
  const bytes = await new File(uri).bytes();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Decode bundled weights and inject them into a face-api net. */
async function loadNet(net: any, model: BundledModel, name = ''): Promise<void> {
  console.log('[faceEngine] Loading model:', name);
  const specs = (model.manifest as any[]).flatMap((group) => group.weights);
  const buffer = await readBin(model.bin);
  const weightMap = tf.io.decodeWeights(buffer, specs);
  await net.loadFromWeightMap(weightMap);
  console.log('[faceEngine] Model loaded successfully:', name);
}

const NET_INSTANCES: Record<NetName, any> = {
  tinyFaceDetector: faceapi.nets.tinyFaceDetector,
  faceLandmark68Net: faceapi.nets.faceLandmark68Net,
  faceExpressionNet: faceapi.nets.faceExpressionNet,
  faceRecognitionNet: faceapi.nets.faceRecognitionNet,
};

/** Idempotent initialisation. Safe to call from multiple places. */
export async function initFaceEngine(): Promise<void> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    _status = 'loading';
    _error = null;
    try {
      console.log('[faceEngine] Initializing TensorFlow.js platform...');
      ensurePlatform();
      setupEnv();
      // Force CPU *before* tf.ready() so tfjs never tries to initialise the
      // WASM/WebGL backend (which can't load in Expo Go and triggers the
      // ".wasm" fetch warning). CPU is pure JS and always available.
      try {
        console.log('[faceEngine] Setting TensorFlow backend to CPU...');
        await tf.setBackend('cpu');
        console.log('[faceEngine] CPU backend set successfully');
      } catch (e) {
        console.warn('[faceEngine] CPU backend setting failed, using default:', e);
        /* fall through to tf.ready()'s default selection */
      }
      await tf.ready();
      console.log('[faceEngine] TensorFlow.js ready');

      // Load sequentially to keep peak memory low on 3GB devices.
      const order: NetName[] = [
        'tinyFaceDetector',
        'faceLandmark68Net',
        'faceExpressionNet',
        'faceRecognitionNet',
      ];
      for (const name of order) {
        await loadNet(NET_INSTANCES[name], MODELS[name], name);
      }

      // Warm up: run one detector pass so kernels JIT-compile now (not mid-enroll)
      // and so the logs reveal this device's tfjs speed up front.
      try {
        console.log('[faceEngine] Backend:', tf.getBackend());
        const tWarm = Date.now();
        const dummy = tf.zeros([CONFIG.detectorInputSize, CONFIG.detectorInputSize, 3], 'int32');
        await analyzeForLiveness(dummy);
        dummy.dispose();
        console.log('[faceEngine] Warmup detector pass in', Date.now() - tWarm, 'ms');
      } catch (e) {
        console.warn('[faceEngine] Warmup failed (non-fatal):', e);
      }

      _status = 'ready';
      console.log('[faceEngine] All models loaded successfully');
    } catch (e: any) {
      console.error('[faceEngine] Initialization failed:', e);
      _status = 'error';
      _error = e?.message ?? String(e);
      _initPromise = null; // allow retry
      throw e;
    }
  })();

  return _initPromise;
}

const detectorOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: CONFIG.detectorInputSize,
  scoreThreshold: CONFIG.detectorScoreThreshold,
});

export type LivenessFace = faceapi.WithFaceExpressions<
  faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>
>;

export type RecognitionFace = faceapi.WithFaceDescriptor<
  faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>
>;

/**
 * Fast path for the liveness loop: detection + landmarks + expressions only
 * (skips the heavy ResNet descriptor).
 */
export async function analyzeForLiveness(input: any): Promise<LivenessFace | undefined> {
  try {
    const result = await faceapi
      .detectSingleFace(input, detectorOptions)
      .withFaceLandmarks()
      .withFaceExpressions();
    if (result) {
      console.log('[faceEngine] Liveness analysis - Score:', result.detection.score);
    } else {
      console.warn('[faceEngine] Liveness analysis - No face detected');
    }
    return result;
  } catch (e) {
    console.error('[faceEngine] Liveness analysis error:', e);
    throw e;
  }
}

/** Recognition path: detection + landmarks + 128-d descriptor. */
export async function analyzeForRecognition(input: any): Promise<RecognitionFace | undefined> {
  try {
    const result = await faceapi
      .detectSingleFace(input, detectorOptions)
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (result) {
      console.log('[faceEngine] Recognition analysis - Score:', result.detection.score, 'Descriptor length:', result.descriptor.length);
    } else {
      console.warn('[faceEngine] Recognition analysis - No face detected');
    }
    return result;
  } catch (e) {
    console.error('[faceEngine] Recognition analysis error:', e);
    throw e;
  }
}
