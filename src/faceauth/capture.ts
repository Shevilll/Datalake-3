/**
 * Capture helper: VisionCamera photo file -> OpenCV Mat (BGR), with the Mat's true decoded
 * dimensions (avoids photo-orientation width/height mismatches).
 */

import * as FileSystem from 'expo-file-system/legacy';
import { type Mat, OpenCV } from 'react-native-fast-opencv';

export interface DecodedPhoto {
  readonly mat: Mat;
  readonly width: number;
  readonly height: number;
}

export async function photoToMat(path: string): Promise<DecodedPhoto> {
  const uri = path.startsWith('file://') ? path : `file://${path}`;
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const mat = OpenCV.base64ToMat(base64);
  // matToBuffer gives the true decoded dims (and won't imencode an empty Mat like toJSValue).
  const { cols, rows } = OpenCV.matToBuffer(mat, 'uint8');
  return { mat, width: cols, height: rows };
}
