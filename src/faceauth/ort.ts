/**
 * ONNX Runtime session management (the single inference engine, §2/§3).
 * Loads the three bundled models from the app bundle (offline, C8) and runs them.
 *
 * Execution-provider selection is kept behind config (§0a): default CPU/XNNPACK now;
 * CoreML (iOS) / NNAPI (Android) can be enabled per-platform without touching callers.
 */

import { Asset } from 'expo-asset';
import * as ort from 'onnxruntime-react-native';

// Metro bundles these as binary assets (see metro.config.js assetExts += onnx).
const MODEL_MODULES = {
  yunet: require('../../assets/models/yunet.onnx'),
  liveness: require('../../assets/models/minifasnet_v2.onnx'),
  recognition: require('../../assets/models/recognition.onnx'),
} as const;

export interface Sessions {
  readonly yunet: ort.InferenceSession;
  readonly liveness: ort.InferenceSession;
  readonly recognition: ort.InferenceSession;
}

async function resolveModelPath(mod: number): Promise<string> {
  const asset = Asset.fromModule(mod);
  if (!asset.localUri) await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  // ORT-RN wants a filesystem path; strip the file:// scheme if present.
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

let cached: Sessions | null = null;

/** Load (and cache) all three inference sessions from the bundled models. */
export async function loadSessions(): Promise<Sessions> {
  if (cached) return cached;
  const [yPath, lPath, rPath] = await Promise.all([
    resolveModelPath(MODEL_MODULES.yunet),
    resolveModelPath(MODEL_MODULES.liveness),
    resolveModelPath(MODEL_MODULES.recognition),
  ]);
  const opts: ort.InferenceSession.SessionOptions = { graphOptimizationLevel: 'all' };
  const [yunet, liveness, recognition] = await Promise.all([
    ort.InferenceSession.create(yPath, opts),
    ort.InferenceSession.create(lPath, opts),
    ort.InferenceSession.create(rPath, opts),
  ]);
  cached = { yunet, liveness, recognition };
  return cached;
}

export function disposeSessions(): void {
  cached = null;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Smoke test: load all three sessions and run a dummy input through each on-device,
 * proving the ORT-RN runtime + bundled-model loading works end-to-end. Logs to the Metro
 * console (readable from the dev server) and returns the log lines for on-screen display.
 */
export async function runSelfTest(): Promise<string[]> {
  const log: string[] = [];
  const push = (s: string): void => {
    log.push(s);
    // eslint-disable-next-line no-console
    console.log('[FaceAuth selftest]', s);
  };

  try {
    push(`ORT version ${ort.env?.versions?.common ?? 'unknown'}`);
    const t0 = Date.now();
    const s = await loadSessions();
    push(`✓ loaded 3 sessions in ${Date.now() - t0}ms`);

    const runDummy = async (
      name: string,
      session: ort.InferenceSession,
      dims: readonly number[],
    ): Promise<void> => {
      const inName = session.inputNames[0];
      if (inName === undefined) throw new Error(`${name}: no input name`);
      const size = dims.reduce((a, b) => a * b, 1);
      const feeds: Record<string, ort.Tensor> = {
        [inName]: new ort.Tensor('float32', new Float32Array(size), dims as number[]),
      };
      const t = Date.now();
      const res = await session.run(feeds);
      const outName = session.outputNames[0];
      const outDims = outName !== undefined ? res[outName]?.dims : undefined;
      push(`✓ ${name}: run ${Date.now() - t}ms, outputs=[${session.outputNames.join(',')}], firstOutDims=${JSON.stringify(outDims)}`);
    };

    await runDummy('yunet', s.yunet, [1, 3, 640, 640]);
    await runDummy('liveness', s.liveness, [1, 3, 80, 80]);
    await runDummy('recognition', s.recognition, [1, 3, 112, 112]);
    push('✅ ALL 3 MODELS LOAD + RUN ON DEVICE');
  } catch (e) {
    push(`❌ selftest failed: ${errMsg(e)}`);
  }
  return log;
}
