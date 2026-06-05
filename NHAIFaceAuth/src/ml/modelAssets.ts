/**
 * Static `require()` map of the bundled face-api model files.
 *
 * Metro returns parsed JSON for `manifest.json` (the tfjs weights manifest) and
 * an asset module reference for the `.bin` weight shard (because `bin` is added
 * to `resolver.assetExts` in metro.config.js). Both are embedded in the app so
 * the models load with **zero network access**.
 */

export type NetName =
  | 'tinyFaceDetector'
  | 'faceLandmark68Net'
  | 'faceExpressionNet'
  | 'faceRecognitionNet';

export interface BundledModel {
  /** Parsed tfjs weights manifest: Array<{ paths: string[]; weights: WeightSpec[] }>. */
  manifest: any;
  /** Asset module reference for the single .bin weight shard. */
  bin: number;
}

export const MODELS: Record<NetName, BundledModel> = {
  tinyFaceDetector: {
    manifest: require('../../assets/models/tiny_face_detector/manifest.json'),
    bin: require('../../assets/models/tiny_face_detector/tiny_face_detector_model.bin'),
  },
  faceLandmark68Net: {
    manifest: require('../../assets/models/face_landmark_68/manifest.json'),
    bin: require('../../assets/models/face_landmark_68/face_landmark_68_model.bin'),
  },
  faceExpressionNet: {
    manifest: require('../../assets/models/face_expression/manifest.json'),
    bin: require('../../assets/models/face_expression/face_expression_model.bin'),
  },
  faceRecognitionNet: {
    manifest: require('../../assets/models/face_recognition/manifest.json'),
    bin: require('../../assets/models/face_recognition/face_recognition_model.bin'),
  },
};
