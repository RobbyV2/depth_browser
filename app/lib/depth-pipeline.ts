const MODEL_ID = 'onnx-community/depth-anything-v2-small'
const INFERENCE_BASE = parseInt(process.env.NEXT_PUBLIC_DEPTH_INFERENCE_BASE || '384', 10)

export type DepthFilterMode = 'nearest' | 'linear' | 'linear-mipmap' | 'quantized' | 'contrast' | 'bilateral'

interface DepthTensor {
  data: Float32Array | Float64Array | number[]
  dims: number[]
  dispose?: () => void
}

interface DepthOutput {
  depth: DepthTensor
  predicted_depth?: DepthTensor
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TransformersModule = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawImageType = any
type DepthPipeline = (input: RawImageType) => Promise<DepthOutput | DepthOutput[]>

interface PipelineState {
  pipeline: DepthPipeline | null
  RawImage: RawImageType | null
  loading: boolean
  error: string | null
  offscreen: OffscreenCanvas | null
  ctx: OffscreenCanvasRenderingContext2D | null
  outputFloat: Float32Array | null
  outputUint8: Uint8Array | null
  cachedDims: { w: number; h: number }
  smoothMin: number
  smoothMax: number
}

const S: PipelineState = {
  pipeline: null,
  RawImage: null,
  loading: false,
  error: null,
  offscreen: null,
  ctx: null,
  outputFloat: null,
  outputUint8: null,
  cachedDims: { w: 0, h: 0 },
  smoothMin: Infinity,
  smoothMax: -Infinity,
}

export interface DepthResult {
  depthFloat: Float32Array
  depthData: Uint8Array
  width: number
  height: number
  inferenceMs: number
}

export async function initDepthPipeline(): Promise<void> {
  if (S.pipeline || S.loading) return

  S.loading = true
  S.error = null

  try {
    const { pipeline, env, RawImage } = await import('@huggingface/transformers')
    env.useBrowserCache = true
    env.allowLocalModels = false
    S.RawImage = RawImage

    console.log('[DEPTH] Loading model...')
    const t0 = performance.now()

    try {
      S.pipeline = await pipeline('depth-estimation', MODEL_ID, {
        device: 'webgpu',
        dtype: 'fp16',
      }) as unknown as DepthPipeline
      console.log(`[DEPTH] WebGPU ready in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
    } catch {
      S.pipeline = await pipeline('depth-estimation', MODEL_ID) as unknown as DepthPipeline
      console.log(`[DEPTH] WASM fallback in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
    }

    S.offscreen = new OffscreenCanvas(INFERENCE_BASE, INFERENCE_BASE)
    S.ctx = S.offscreen.getContext('2d', { willReadFrequently: true, alpha: false }) as OffscreenCanvasRenderingContext2D
  } catch (err) {
    S.error = err instanceof Error ? err.message : String(err)
    console.error('[DEPTH] Init failed:', S.error)
    throw err
  } finally {
    S.loading = false
  }
}

export const isDepthPipelineReady = () => S.pipeline !== null
export const isDepthPipelineLoading = () => S.loading
export const getDepthPipelineError = () => S.error
export const getDefaultFilterMode = (): DepthFilterMode =>
  (process.env.NEXT_PUBLIC_DEPTH_FILTER_MODE as DepthFilterMode) || 'nearest'
export const FILTER_MODES: DepthFilterMode[] = ['nearest', 'linear', 'linear-mipmap', 'quantized', 'contrast', 'bilateral']

// Post-processing functions for different filter modes
function applyQuantization(data: Float32Array, levels: number = 8): void {
  const step = 1.0 / levels
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.floor(data[i] / step) * step
  }
}

function applyContrast(data: Float32Array, gamma: number = 0.5): void {
  // Gamma curve to enhance mid-range contrast and sharpen transitions
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.pow(data[i], gamma)
  }
}

function applyBilateral(data: Float32Array, width: number, height: number): void {
  // Simplified bilateral filter: smooth spatially but preserve depth edges
  const sigma_space = 2.0
  const sigma_depth = 0.1
  const radius = 2
  const temp = new Float32Array(data.length)
  temp.set(data)

  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      const idx = y * width + x
      const centerDepth = temp[idx]
      let sum = 0
      let weightSum = 0

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          const ny = y + dy
          const nidx = ny * width + nx
          const neighborDepth = temp[nidx]

          // Spatial weight (Gaussian)
          const spatialDist = Math.sqrt(dx * dx + dy * dy)
          const spatialWeight = Math.exp(-(spatialDist * spatialDist) / (2 * sigma_space * sigma_space))

          // Depth weight (preserve edges)
          const depthDiff = Math.abs(neighborDepth - centerDepth)
          const depthWeight = Math.exp(-(depthDiff * depthDiff) / (2 * sigma_depth * sigma_depth))

          const weight = spatialWeight * depthWeight
          sum += neighborDepth * weight
          weightSum += weight
        }
      }

      data[idx] = sum / weightSum
    }
  }
}

export async function estimateDepth(
  src: HTMLVideoElement | HTMLCanvasElement,
  filterMode: DepthFilterMode = getDefaultFilterMode()
): Promise<DepthResult> {
  if (!S.pipeline || !S.RawImage || !S.offscreen || !S.ctx) {
    throw new Error('Pipeline not initialized')
  }

  const t0 = performance.now()

  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.width
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.height

  const aspect = sw / sh
  let tw: number, th: number
  if (aspect >= 1) {
    th = INFERENCE_BASE
    tw = (INFERENCE_BASE * aspect) | 0
  } else {
    tw = INFERENCE_BASE
    th = (INFERENCE_BASE / aspect) | 0
  }

  if (S.offscreen.width !== tw || S.offscreen.height !== th) {
    S.offscreen.width = tw
    S.offscreen.height = th
    S.cachedDims = { w: 0, h: 0 }
  }

  S.ctx.drawImage(src, 0, 0, tw, th)
  const { data } = S.ctx.getImageData(0, 0, tw, th)
  const input = new S.RawImage(data, tw, th, 4)

  const raw = await S.pipeline(input)
  const out = Array.isArray(raw) ? raw[0] : raw
  const tensor = out.predicted_depth || out.depth
  const { data: d, dims } = tensor
  const [h, w] = dims.length === 3 ? [dims[1], dims[2]] : dims
  const n = w * h

  if (S.cachedDims.w !== w || S.cachedDims.h !== h) {
    S.outputFloat = new Float32Array(n)
    S.outputUint8 = new Uint8Array(n)
    S.cachedDims = { w, h }
    S.smoothMin = Infinity
    S.smoothMax = -Infinity
  }

  // Find frame min/max
  let frameMin = d[0], frameMax = d[0]
  for (let i = 1; i < n; i++) {
    const v = d[i]
    if (v < frameMin) frameMin = v
    else if (v > frameMax) frameMax = v
  }

  // Temporal smoothing
  const alpha = 0.3
  if (S.smoothMin === Infinity) {
    S.smoothMin = frameMin
    S.smoothMax = frameMax
  } else {
    S.smoothMin += (frameMin - S.smoothMin) * alpha
    S.smoothMax += (frameMax - S.smoothMax) * alpha
  }

  const range = S.smoothMax - S.smoothMin || 1
  const invRange = 1 / range
  const floatBuf = S.outputFloat!
  const uint8Buf = S.outputUint8!

  // Normalize (closer = higher value for displacement toward camera)
  for (let i = 0; i < n; i++) {
    const normalized = (d[i] - S.smoothMin) * invRange
    floatBuf[i] = normalized
  }

  // Apply filter-specific post-processing
  switch (filterMode) {
    case 'quantized':
      applyQuantization(floatBuf, 12) // 12 discrete depth levels
      break
    case 'contrast':
      applyContrast(floatBuf, 0.6) // Gamma < 1 = more contrast in darks
      break
    case 'bilateral':
      applyBilateral(floatBuf, w, h)
      break
    // nearest, linear, linear-mipmap: no post-processing, just texture filter difference
  }

  // Convert to uint8 for 2D preview
  for (let i = 0; i < n; i++) {
    uint8Buf[i] = (floatBuf[i] * 255) | 0
  }

  tensor.dispose?.()

  const ms = performance.now() - t0
  console.log(`[BENCH-GPU] ${ms.toFixed(0)}ms (${filterMode})`)

  return { depthFloat: floatBuf, depthData: uint8Buf, width: w, height: h, inferenceMs: ms }
}
