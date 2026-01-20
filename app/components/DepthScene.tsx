'use client'

import { useRef, useEffect, useMemo, MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { type DepthResult, type DepthFilterMode } from '../lib/depth-pipeline'

// Interpolation factor per frame (0.15 = smooth, 0.3 = responsive)
const LERP_FACTOR = 0.2

// Border fade width (fraction of image dimension)
const BORDER_FADE = 0.05

// Map filter mode to THREE.js texture filters
function getTextureFilters(mode: DepthFilterMode): {
  min: THREE.MinificationTextureFilter
  mag: THREE.MagnificationTextureFilter
} {
  switch (mode) {
    case 'nearest':
    case 'quantized':
      return { min: THREE.NearestFilter, mag: THREE.NearestFilter }
    case 'linear':
    case 'contrast':
    case 'bilateral':
      return { min: THREE.LinearFilter, mag: THREE.LinearFilter }
    case 'linear-mipmap':
      return { min: THREE.LinearMipmapLinearFilter, mag: THREE.LinearFilter }
    default:
      return { min: THREE.NearestFilter, mag: THREE.NearestFilter }
  }
}

// Calculate approximate median using sampling (fast, good enough for centering)
function approximateMedian(data: Float32Array): number {
  const len = data.length
  // Sample ~1000 points for speed
  const sampleSize = Math.min(1000, len)
  const step = Math.max(1, Math.floor(len / sampleSize))
  const samples: number[] = []

  for (let i = 0; i < len; i += step) {
    samples.push(data[i])
  }

  samples.sort((a, b) => a - b)
  const mid = samples.length >> 1
  return samples.length % 2 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2
}

// Re-center depth around median (middle depth = 0.5, relative displacement)
function centerDepthAroundMedian(data: Float32Array): void {
  const median = approximateMedian(data)
  const offset = 0.5 - median

  for (let i = 0; i < data.length; i++) {
    // Shift so median becomes 0.5, clamp to valid range
    data[i] = Math.max(0, Math.min(1, data[i] + offset))
  }
}

// Apply border fade mask to depth buffer (pins edges to neutral displacement)
function applyBorderMask(
  data: Float32Array,
  width: number,
  height: number,
  fadeWidth: number
): void {
  const fadePixelsX = Math.max(1, Math.floor(width * fadeWidth))
  const fadePixelsY = Math.max(1, Math.floor(height * fadeWidth))

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Calculate distance from each edge (0 at edge, 1 at fade boundary)
      const leftFade = Math.min(x / fadePixelsX, 1)
      const rightFade = Math.min((width - 1 - x) / fadePixelsX, 1)
      const topFade = Math.min(y / fadePixelsY, 1)
      const bottomFade = Math.min((height - 1 - y) / fadePixelsY, 1)

      // Combined mask (multiply all edges)
      const mask = leftFade * rightFade * topFade * bottomFade

      // Apply mask (fade toward 0.5 which is neutral displacement)
      const idx = y * width + x
      data[idx] = 0.5 + (data[idx] - 0.5) * mask
    }
  }
}

// Lerp between two depth buffers in place
function lerpDepthBuffers(current: Float32Array, target: Float32Array, factor: number): boolean {
  const len = current.length
  if (len !== target.length) return false

  // Track if any significant change occurred
  let maxDelta = 0

  for (let i = 0; i < len; i++) {
    const delta = target[i] - current[i]
    current[i] += delta * factor
    const absDelta = delta < 0 ? -delta : delta
    if (absDelta > maxDelta) maxDelta = absDelta
  }

  // Return true if still interpolating (max delta > threshold)
  return maxDelta > 0.001
}

interface DepthMeshProps {
  videoElement: HTMLVideoElement | null
  depthResultRef: MutableRefObject<DepthResult | null>
  filterMode: DepthFilterMode
}

function DepthMesh({ videoElement, depthResultRef, filterMode }: DepthMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const videoTextureRef = useRef<THREE.VideoTexture | null>(null)
  const depthTextureRef = useRef<THREE.DataTexture | null>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const currentFilterModeRef = useRef<DepthFilterMode | null>(null)
  const lastDepthChecksumRef = useRef<number>(0)

  // Interpolation buffers
  const currentDepthRef = useRef<Float32Array | null>(null) // Displayed (interpolated)
  const targetDepthRef = useRef<Float32Array | null>(null) // Target from inference
  const isInterpolatingRef = useRef<boolean>(false)
  const depthDimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })

  const { camera } = useThree()

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.position.set(0, 0, 1.8)
      camera.lookAt(0, 0, 0)
    }
  }, [camera])

  // Create video texture once
  useEffect(() => {
    if (!videoElement) return

    const videoTexture = new THREE.VideoTexture(videoElement)
    videoTexture.minFilter = THREE.LinearFilter
    videoTexture.magFilter = THREE.LinearFilter
    videoTexture.colorSpace = THREE.SRGBColorSpace
    videoTextureRef.current = videoTexture

    if (materialRef.current) {
      materialRef.current.map = videoTexture
      materialRef.current.needsUpdate = true
    }

    return () => {
      videoTexture.dispose()
      videoTextureRef.current = null
    }
  }, [videoElement])

  useFrame(() => {
    // Update video texture
    if (videoTextureRef.current && videoElement && videoElement.readyState >= 2) {
      videoTextureRef.current.needsUpdate = true
    }

    // Check for new depth data
    const depthResult = depthResultRef.current
    if (!depthResult || !materialRef.current) return

    const { depthFloat, width, height } = depthResult

    // Sample a few values to detect changes (cheap checksum)
    const len = depthFloat.length
    const checksum =
      (depthFloat[0] || 0) +
      (depthFloat[len >> 2] || 0) +
      (depthFloat[len >> 1] || 0) +
      (depthFloat[(len * 3) >> 2] || 0) +
      (depthFloat[len - 1] || 0)

    const hasNewData = checksum !== lastDepthChecksumRef.current
    if (hasNewData) {
      lastDepthChecksumRef.current = checksum
    }

    const filters = getTextureFilters(filterMode)
    const needsMipmaps = filterMode === 'linear-mipmap'

    // Check if we need to recreate buffers (dimensions or filter changed)
    const needsNewTexture =
      !depthTextureRef.current ||
      depthDimsRef.current.w !== width ||
      depthDimsRef.current.h !== height ||
      currentFilterModeRef.current !== filterMode

    if (needsNewTexture) {
      // Dispose old texture
      if (depthTextureRef.current) {
        depthTextureRef.current.dispose()
      }

      // Create interpolation buffers
      const bufferSize = width * height
      currentDepthRef.current = new Float32Array(bufferSize)
      targetDepthRef.current = new Float32Array(bufferSize)
      depthDimsRef.current = { w: width, h: height }

      // Initialize both buffers with first frame (no interpolation lag on start)
      currentDepthRef.current.set(depthFloat)
      targetDepthRef.current.set(depthFloat)
      // Center around median (middle depth = neutral plane)
      centerDepthAroundMedian(currentDepthRef.current)
      centerDepthAroundMedian(targetDepthRef.current)
      // Apply border mask to pin edges
      applyBorderMask(currentDepthRef.current, width, height, BORDER_FADE)
      applyBorderMask(targetDepthRef.current, width, height, BORDER_FADE)

      // Create texture using the current (interpolated) buffer
      const texture = new THREE.DataTexture(
        currentDepthRef.current,
        width,
        height,
        THREE.RedFormat,
        THREE.FloatType
      )
      texture.flipY = true
      texture.minFilter = filters.min
      texture.magFilter = filters.mag
      texture.generateMipmaps = needsMipmaps
      texture.needsUpdate = true

      depthTextureRef.current = texture
      currentFilterModeRef.current = filterMode
      materialRef.current.displacementMap = texture
      materialRef.current.needsUpdate = true

      isInterpolatingRef.current = false
    } else if (hasNewData && targetDepthRef.current) {
      // New depth data arrived - center and mask
      targetDepthRef.current.set(depthFloat)
      centerDepthAroundMedian(targetDepthRef.current)
      applyBorderMask(targetDepthRef.current, width, height, BORDER_FADE)
      isInterpolatingRef.current = true
    }

    // Interpolate current toward target every frame
    if (
      isInterpolatingRef.current &&
      currentDepthRef.current &&
      targetDepthRef.current &&
      depthTextureRef.current
    ) {
      const stillInterpolating = lerpDepthBuffers(
        currentDepthRef.current,
        targetDepthRef.current,
        LERP_FACTOR
      )
      isInterpolatingRef.current = stillInterpolating
      depthTextureRef.current.needsUpdate = true
    }
  })

  const aspectRatio =
    videoElement?.videoWidth && videoElement?.videoHeight
      ? videoElement.videoWidth / videoElement.videoHeight
      : 16 / 9

  const geometry = useMemo(() => {
    const baseSegments = 192
    const segX = Math.round(baseSegments * aspectRatio)
    const segY = baseSegments
    return new THREE.PlaneGeometry(aspectRatio, 1, segX, segY)
  }, [aspectRatio])

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial
        ref={materialRef}
        side={THREE.DoubleSide}
        displacementScale={0.3}
        displacementBias={-0.15}
        toneMapped={false}
        emissiveIntensity={0}
      />
    </mesh>
  )
}

interface DepthSceneProps {
  videoElement: HTMLVideoElement | null
  depthResultRef: MutableRefObject<DepthResult | null>
  filterMode: DepthFilterMode
}

export default function DepthScene({ videoElement, depthResultRef, filterMode }: DepthSceneProps) {
  return (
    <Canvas
      camera={{ fov: 50, near: 0.1, far: 100 }}
      style={{ background: '#000' }}
      gl={{ toneMapping: THREE.NoToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
    >
      <ambientLight intensity={2} />
      <DepthMesh
        videoElement={videoElement}
        depthResultRef={depthResultRef}
        filterMode={filterMode}
      />
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={0.5}
        maxDistance={5}
      />
    </Canvas>
  )
}
