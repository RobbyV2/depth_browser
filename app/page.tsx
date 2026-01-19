'use client'

import { useState, useRef, useCallback, FormEvent, lazy, Suspense } from 'react'
import {
  initDepthPipeline,
  isDepthPipelineReady,
  estimateDepth,
  getDefaultFilterMode,
  FILTER_MODES,
  type DepthResult,
  type DepthFilterMode,
} from './lib/depth-pipeline'

const DepthScene = lazy(() => import('./components/DepthScene'))

declare class CaptureController {
  setFocusBehavior(behavior: 'no-focus-change' | 'focus-captured-surface'): void
}

function searchToUrl(input: string): string {
  try {
    return new URL(input).toString()
  } catch {
    // not a valid URL
  }
  try {
    const url = new URL(`https://${input}`)
    if (url.hostname.includes('.')) return url.toString()
  } catch {
    // not a valid URL
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`
}

export default function Home() {
  const [url, setUrl] = useState('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [lastDepthResult, setLastDepthResult] = useState<DepthResult | null>(null)
  const [show3D, setShow3D] = useState(false)
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const [filterMode, setFilterMode] = useState<DepthFilterMode>(getDefaultFilterMode)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const frameCountRef = useRef(0)
  const lastLogTimeRef = useRef(0)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const depthPreviewRef = useRef<HTMLCanvasElement | null>(null)
  const depthCanvasCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const depthImageDataRef = useRef<ImageData | null>(null)

  const depthReadyRef = useRef(false)
  const depthRunningRef = useRef(false)
  const lastDepthTimeRef = useRef(0)
  const targetDepthIntervalRef = useRef(
    1000 / parseInt(process.env.NEXT_PUBLIC_DEPTH_TARGET_FPS || '15', 10)
  )

  const renderDepthToCanvas = useCallback((result: DepthResult) => {
    const canvas = depthPreviewRef.current
    if (!canvas) return

    // Resize canvas if needed
    if (canvas.width !== result.width || canvas.height !== result.height) {
      canvas.width = result.width
      canvas.height = result.height
      depthCanvasCtxRef.current = null
      depthImageDataRef.current = null
    }

    // Get or create context
    if (!depthCanvasCtxRef.current) {
      depthCanvasCtxRef.current = canvas.getContext('2d', { willReadFrequently: false })
    }
    const ctx = depthCanvasCtxRef.current
    if (!ctx) return

    // Reuse ImageData buffer
    if (!depthImageDataRef.current) {
      depthImageDataRef.current = ctx.createImageData(result.width, result.height)
    }

    const imgData = depthImageDataRef.current.data
    const depth = result.depthData
    const len = depth.length

    // Unrolled loop for speed
    for (let i = 0, j = 0; i < len; i++, j += 4) {
      const v = depth[i]
      imgData[j] = v
      imgData[j + 1] = v
      imgData[j + 2] = v
      imgData[j + 3] = 255
    }

    ctx.putImageData(depthImageDataRef.current, 0, 0)
  }, [])

  const runDepthOnFrame = useCallback(async (video: HTMLVideoElement) => {
    if (!depthReadyRef.current || depthRunningRef.current) return

    depthRunningRef.current = true
    try {
      const result = await estimateDepth(video, filterMode)
      setLastDepthResult(result)
      renderDepthToCanvas(result)
    } catch (err) {
      console.error('[DEPTH] Inference error:', err)
    } finally {
      depthRunningRef.current = false
    }
  }, [renderDepthToCanvas, filterMode])

  const captureFrame = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(captureFrame)
      return
    }

    frameCountRef.current++
    const now = performance.now()

    // Time-based depth throttling - only run if enough time passed and not already running
    if (depthReadyRef.current && !depthRunningRef.current) {
      const elapsed = now - lastDepthTimeRef.current
      if (elapsed >= targetDepthIntervalRef.current) {
        lastDepthTimeRef.current = now
        runDepthOnFrame(video)
      }
    }

    // FPS logging
    if (now - lastLogTimeRef.current >= 1000) {
      const fps = frameCountRef.current / ((now - lastLogTimeRef.current) / 1000)
      console.log(`[CAPTURE] ${fps.toFixed(0)} fps | ${video.videoWidth}x${video.videoHeight}`)
      frameCountRef.current = 0
      lastLogTimeRef.current = now
    }

    rafRef.current = requestAnimationFrame(captureFrame)
  }, [runDepthOnFrame])

  const startCapture = async () => {
    setError(null)
    setStatus('Starting...')

    try {
      const controller = typeof CaptureController !== 'undefined' ? new CaptureController() : null

      const displayMediaOptions: DisplayMediaStreamOptions = {
        video: { frameRate: { ideal: 60, max: 60 } },
        audio: false,
      }

      if (controller) {
        Object.assign(displayMediaOptions, { controller, surfaceSwitching: 'include' })
      }

      const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions)

      if (controller) {
        controller.setFocusBehavior('no-focus-change')
      }

      const video = document.createElement('video')
      video.autoplay = true
      video.muted = true
      video.playsInline = true
      video.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:8px'

      if (previewRef.current) {
        previewRef.current.innerHTML = ''
        previewRef.current.appendChild(video)
      }

      setIsCapturing(true)
      video.srcObject = stream

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 3000)
        video.addEventListener('canplay', () => {
          clearTimeout(timeout)
          video.play().finally(resolve)
        }, { once: true })
      })

      videoRef.current = video
      streamRef.current = stream
      setVideoElement(video)
      frameCountRef.current = 0
      lastLogTimeRef.current = performance.now()

      stream.getVideoTracks()[0].onended = stopCapture

      console.log(`[CAPTURE] Started: ${video.videoWidth}x${video.videoHeight}`)
      setStatus(`${video.videoWidth}x${video.videoHeight}`)

      rafRef.current = requestAnimationFrame(captureFrame)

      // Load depth model
      if (!isDepthPipelineReady()) {
        setStatus('Loading depth model...')
        try {
          await initDepthPipeline()
          depthReadyRef.current = true
          setStatus('Depth active')
        } catch (err) {
          console.error('[DEPTH] Load failed:', err)
          setStatus('Depth unavailable')
        }
      } else {
        depthReadyRef.current = true
        setStatus('Depth active')
      }
    } catch (err) {
      console.error('[CAPTURE] Failed:', err)
      setError(err instanceof Error ? err.message : 'Capture failed')
      setStatus('')
    }
  }

  const stopCapture = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (videoRef.current?.parentNode) {
      videoRef.current.parentNode.removeChild(videoRef.current)
    }
    videoRef.current = null
    setVideoElement(null)
    setIsCapturing(false)
    setStatus('')
    setShow3D(false)
  }, [])

  const handleOpenUrl = (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    window.open(searchToUrl(url), '_blank')
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      backgroundColor: '#1a1a2e',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1.5rem',
      padding: '2rem',
      overflow: 'auto',
    }}>
      <h1 style={{ color: '#e94560', margin: 0, fontFamily: 'system-ui' }}>
        DepthXR Capture
      </h1>

      <div style={{ display: 'flex', gap: '1rem' }}>
        {!isCapturing ? (
          <button
            onClick={startCapture}
            style={{
              padding: '1rem 2rem',
              fontSize: '1.25rem',
              backgroundColor: '#e94560',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Start Capture
          </button>
        ) : (
          <>
            <button
              onClick={stopCapture}
              style={{
                padding: '1rem 2rem',
                fontSize: '1.25rem',
                backgroundColor: '#444',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Stop Capture
            </button>
            <button
              onClick={() => setShow3D(!show3D)}
              style={{
                padding: '1rem 2rem',
                fontSize: '1.25rem',
                backgroundColor: show3D ? '#0f3460' : '#16213e',
                color: show3D ? '#e94560' : '#8892b0',
                border: show3D ? '2px solid #e94560' : '2px solid #0f3460',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              {show3D ? '3D Active' : 'View 3D'}
            </button>
          </>
        )}
      </div>

      {status && (
        <div style={{ color: '#8892b0', fontSize: '0.875rem' }}>{status}</div>
      )}

      {isCapturing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ color: '#8892b0', fontSize: '0.75rem' }}>Filter:</label>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as DepthFilterMode)}
            style={{
              padding: '0.25rem 0.5rem',
              fontSize: '0.75rem',
              backgroundColor: '#16213e',
              color: '#8892b0',
              border: '1px solid #0f3460',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {FILTER_MODES.map((mode) => (
              <option key={mode} value={mode}>{mode}</option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div style={{ color: '#e94560', fontFamily: 'monospace' }}>Error: {error}</div>
      )}

      {show3D && isCapturing && (
        <div style={{ width: '100%', maxWidth: '1200px', aspectRatio: '16 / 9', borderRadius: '8px', overflow: 'hidden' }}>
          <Suspense fallback={<div style={{ color: '#8892b0' }}>Loading 3D scene...</div>}>
            <DepthScene videoElement={videoElement} depthResult={lastDepthResult} filterMode={filterMode} />
          </Suspense>
        </div>
      )}

      {/* Always render preview div to keep video element alive */}
      <div style={{ display: show3D ? 'none' : 'flex', gap: '1rem', width: '100%', maxWidth: '1200px', justifyContent: 'center' }}>
        <div
          ref={previewRef}
          style={{
            flex: 2,
            aspectRatio: '16 / 9',
            backgroundColor: '#000',
            borderRadius: '8px',
            overflow: 'hidden',
            display: isCapturing ? 'block' : 'none',
          }}
        />

        {isCapturing && !show3D && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ color: '#8892b0', fontSize: '0.75rem' }}>
              Depth Map {lastDepthResult && `(${lastDepthResult.inferenceMs.toFixed(0)}ms)`}
            </div>
            <canvas
              ref={depthPreviewRef}
              style={{
                width: '100%',
                aspectRatio: '16 / 9',
                backgroundColor: '#111',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                objectFit: 'contain',
              }}
            />
          </div>
        )}
      </div>

      <div style={{
        padding: '1rem',
        backgroundColor: '#16213e',
        borderRadius: '8px',
        width: '100%',
        maxWidth: '400px',
      }}>
        <div style={{ color: '#5c6370', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
          Quick open (optional)
        </div>
        <form onSubmit={handleOpenUrl} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="URL or search..."
            style={{
              flex: 1,
              padding: '0.5rem 0.75rem',
              fontSize: '0.875rem',
              border: '1px solid #0f3460',
              borderRadius: '6px',
              backgroundColor: '#1a1a2e',
              color: '#8892b0',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={!url.trim()}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              backgroundColor: url.trim() ? '#0f3460' : '#333',
              color: '#8892b0',
              border: 'none',
              borderRadius: '6px',
              cursor: url.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Open
          </button>
        </form>
      </div>
    </div>
  )
}
