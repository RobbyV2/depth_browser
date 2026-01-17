'use client'

import { useState, useRef, FormEvent } from 'react'

// CaptureController API (Chrome 109+)
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

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const frameCountRef = useRef(0)
  const lastLogTimeRef = useRef(0)
  const previewRef = useRef<HTMLDivElement | null>(null)

  const captureFrame = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = ctxRef.current

    if (!video || !canvas || !ctx || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(captureFrame)
      return
    }

    const captureStart = performance.now()
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const captureEnd = performance.now()

    const readStart = performance.now()
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const readEnd = performance.now()

    frameCountRef.current++

    const now = performance.now()
    if (now - lastLogTimeRef.current >= 1000) {
      const fps = frameCountRef.current / ((now - lastLogTimeRef.current) / 1000)
      console.log(
        `[CAPTURE] fps: ${fps.toFixed(1)} | draw: ${(captureEnd - captureStart).toFixed(2)}ms | read: ${(readEnd - readStart).toFixed(2)}ms | ${canvas.width}x${canvas.height} | ${imageData.data.length} bytes`
      )
      frameCountRef.current = 0
      lastLogTimeRef.current = now
    }

    rafRef.current = requestAnimationFrame(captureFrame)
  }

  const startCapture = async () => {
    setError(null)

    try {
      // CaptureController allows preventing focus switch (Chrome 109+ only)
      const controller = typeof CaptureController !== 'undefined' ? new CaptureController() : null

      const displayMediaOptions: DisplayMediaStreamOptions = {
        video: {
          frameRate: { ideal: 60, max: 60 },
        },
        audio: false,
      }

      // Add Chrome-specific options if supported
      if (controller) {
        Object.assign(displayMediaOptions, {
          controller,
          surfaceSwitching: 'include',
        })
      }

      const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions)

      // Keep focus on this app instead of switching to captured window (Chrome only)
      if (controller) {
        controller.setFocusBehavior('no-focus-change')
      }

      const video = document.createElement('video')
      video.autoplay = true
      video.muted = true
      video.playsInline = true
      video.style.width = '100%'
      video.style.height = '100%'
      video.style.objectFit = 'contain'
      video.style.borderRadius = '8px'

      // Add video to preview container immediately
      if (previewRef.current) {
        previewRef.current.innerHTML = ''
        previewRef.current.appendChild(video)
      }

      // Show preview now
      setIsCapturing(true)

      video.srcObject = stream

      await new Promise<void>((resolve, reject) => {
        const onCanPlay = () => {
          video.removeEventListener('canplay', onCanPlay)
          video.removeEventListener('error', onError)
          video.play()
            .then(() => resolve())
            .catch(() => resolve())
        }
        const onError = () => {
          video.removeEventListener('canplay', onCanPlay)
          video.removeEventListener('error', onError)
          reject(new Error('Video stream failed'))
        }
        video.addEventListener('canplay', onCanPlay)
        video.addEventListener('error', onError)
      })

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('No canvas context')

      videoRef.current = video
      canvasRef.current = canvas
      ctxRef.current = ctx
      streamRef.current = stream
      frameCountRef.current = 0
      lastLogTimeRef.current = performance.now()

      stream.getVideoTracks()[0].onended = stopCapture

      console.log(`[CAPTURE] Started: ${video.videoWidth}x${video.videoHeight}`)

      rafRef.current = requestAnimationFrame(captureFrame)
    } catch (err) {
      console.error('[CAPTURE] Failed:', err)
      setError(err instanceof Error ? err.message : 'Capture failed')
    }
  }

  const stopCapture = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
      if (videoRef.current.parentNode) {
        videoRef.current.parentNode.removeChild(videoRef.current)
      }
      videoRef.current = null
    }

    canvasRef.current = null
    ctxRef.current = null
    setIsCapturing(false)
    console.log('[CAPTURE] Stopped')
  }

  const handleOpenUrl = (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return

    const targetUrl = searchToUrl(url)
    window.open(targetUrl, '_blank')
    console.log(`[NAV] Opened: ${targetUrl}`)
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        backgroundColor: '#1a1a2e',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2rem',
        padding: '2rem',
      }}
    >
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
        )}
      </div>

      <div
        ref={previewRef}
        style={{
          width: '100%',
          maxWidth: '800px',
          aspectRatio: '16 / 9',
          backgroundColor: '#000',
          borderRadius: '8px',
          overflow: 'hidden',
          display: isCapturing ? 'block' : 'none',
        }}
      />

      {error && (
        <div style={{ color: '#e94560', fontFamily: 'monospace' }}>
          Error: {error}
        </div>
      )}

      <div
        style={{
          marginTop: '2rem',
          padding: '1.5rem',
          backgroundColor: '#16213e',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '500px',
        }}
      >
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
