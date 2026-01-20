/**
 * Server-side depth estimation via WebSocket.
 * Sends JPEG frames to Rust/PyO3 backend, receives grayscale depth buffers.
 */

export interface ServerDepthResult {
  depthFloat: Float32Array
  depthData: Uint8Array
  width: number
  height: number
  rttMs: number
}

interface ServerDepthState {
  ws: WebSocket | null
  connected: boolean
  pending: Map<
    number,
    {
      resolve: (result: ServerDepthResult) => void
      reject: (error: Error) => void
      startTime: number
      width: number
      height: number
    }
  >
  messageId: number
  offscreen: OffscreenCanvas | null
  ctx: OffscreenCanvasRenderingContext2D | null
}

const state: ServerDepthState = {
  ws: null,
  connected: false,
  pending: new Map(),
  messageId: 0,
  offscreen: null,
  ctx: null,
}

const SEND_WIDTH = 640
const SEND_HEIGHT = 360

export function isServerDepthConnected(): boolean {
  return state.connected
}

export async function connectServerDepth(): Promise<void> {
  if (state.ws && state.connected) return

  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/depth`

    console.log('[SERVER-DEPTH] Connecting to', wsUrl)

    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      console.log('[SERVER-DEPTH] Connected')
      state.ws = ws
      state.connected = true

      // Initialize offscreen canvas for JPEG encoding
      state.offscreen = new OffscreenCanvas(SEND_WIDTH, SEND_HEIGHT)
      state.ctx = state.offscreen.getContext('2d', {
        alpha: false,
      }) as OffscreenCanvasRenderingContext2D

      resolve()
    }

    ws.onmessage = event => {
      if (event.data instanceof ArrayBuffer) {
        // Find the oldest pending request
        const entries = Array.from(state.pending.entries())
        if (entries.length === 0) return

        const [id, req] = entries[0]
        state.pending.delete(id)

        const rttMs = performance.now() - req.startTime
        const data = new Uint8Array(event.data)

        // Parse header: width (2 bytes BE) + height (2 bytes BE) + depth data
        const width = (data[0] << 8) | data[1]
        const height = (data[2] << 8) | data[3]
        const depthData = data.slice(4)

        // Convert to float32 (0-1 range)
        const depthFloat = new Float32Array(depthData.length)
        for (let i = 0; i < depthData.length; i++) {
          depthFloat[i] = depthData[i] / 255
        }

        req.resolve({
          depthFloat,
          depthData,
          width,
          height,
          rttMs,
        })
      } else if (typeof event.data === 'string') {
        if (event.data.startsWith('error:')) {
          console.error('[SERVER-DEPTH]', event.data)
        }
      }
    }

    ws.onerror = event => {
      console.error('[SERVER-DEPTH] WebSocket error', event)
      reject(new Error('WebSocket connection failed'))
    }

    ws.onclose = () => {
      console.log('[SERVER-DEPTH] Disconnected')
      state.ws = null
      state.connected = false

      // Reject all pending requests
      for (const [, req] of state.pending) {
        req.reject(new Error('WebSocket disconnected'))
      }
      state.pending.clear()
    }
  })
}

export function disconnectServerDepth(): void {
  if (state.ws) {
    state.ws.close()
    state.ws = null
    state.connected = false
  }
}

export async function estimateServerDepth(
  src: HTMLVideoElement | HTMLCanvasElement
): Promise<ServerDepthResult> {
  if (!state.ws || !state.connected || !state.offscreen || !state.ctx) {
    throw new Error('Server depth not connected')
  }

  // Get source dimensions
  const srcW = src instanceof HTMLVideoElement ? src.videoWidth : src.width
  const srcH = src instanceof HTMLVideoElement ? src.videoHeight : src.height

  // Scale to send dimensions maintaining aspect ratio
  const aspect = srcW / srcH
  let sendW = SEND_WIDTH
  let sendH = SEND_HEIGHT
  if (aspect > SEND_WIDTH / SEND_HEIGHT) {
    sendH = Math.round(SEND_WIDTH / aspect)
  } else {
    sendW = Math.round(SEND_HEIGHT * aspect)
  }

  // Resize offscreen canvas if needed
  if (state.offscreen.width !== sendW || state.offscreen.height !== sendH) {
    state.offscreen.width = sendW
    state.offscreen.height = sendH
  }

  // Draw and encode to JPEG
  state.ctx.drawImage(src, 0, 0, sendW, sendH)
  const blob = await state.offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
  const jpegBytes = await blob.arrayBuffer()

  // Send and wait for response
  return new Promise((resolve, reject) => {
    const id = state.messageId++
    state.pending.set(id, {
      resolve,
      reject,
      startTime: performance.now(),
      width: sendW,
      height: sendH,
    })

    state.ws!.send(jpegBytes)
  })
}
