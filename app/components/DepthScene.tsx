'use client'

import { useRef, useEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { type DepthResult, type DepthFilterMode } from '../lib/depth-pipeline'

// Map filter mode to THREE.js texture filters
function getTextureFilters(mode: DepthFilterMode): {
  min: THREE.MinificationTextureFilter
  mag: THREE.MagnificationTextureFilter
} {
  switch (mode) {
    case 'nearest':
    case 'quantized': // Quantized benefits from nearest to preserve hard steps
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

interface DepthMeshProps {
  videoElement: HTMLVideoElement | null
  depthResult: DepthResult | null
  filterMode: DepthFilterMode
}

function DepthMesh({ videoElement, depthResult, filterMode }: DepthMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const videoTextureRef = useRef<THREE.VideoTexture | null>(null)
  const depthTextureRef = useRef<THREE.DataTexture | null>(null)
  const depthDataRef = useRef<Float32Array | null>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const currentFilterModeRef = useRef<DepthFilterMode | null>(null)

  const { camera } = useThree()

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.position.set(0, 0, 1.8)
      camera.lookAt(0, 0, 0)
    }
  }, [camera])

  // Create video texture
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

  // Update depth texture
  useEffect(() => {
    if (!depthResult || !materialRef.current) return

    const { depthFloat, width, height } = depthResult
    const filters = getTextureFilters(filterMode)
    const needsMipmaps = filterMode === 'linear-mipmap'

    // Recreate texture if dimensions or filter mode changed
    const dimsChanged = !depthTextureRef.current ||
      depthTextureRef.current.image.width !== width ||
      depthTextureRef.current.image.height !== height
    const filterChanged = currentFilterModeRef.current !== filterMode

    if (dimsChanged || filterChanged) {
      if (depthTextureRef.current) {
        depthTextureRef.current.dispose()
      }

      depthDataRef.current = new Float32Array(width * height)
      depthDataRef.current.set(depthFloat)

      const texture = new THREE.DataTexture(
        depthDataRef.current,
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
    } else if (depthDataRef.current) {
      depthDataRef.current.set(depthFloat)
      depthTextureRef.current!.needsUpdate = true
    }
  }, [depthResult, filterMode])

  // Update video texture each frame
  useFrame(() => {
    if (videoTextureRef.current && videoElement && videoElement.readyState >= 2) {
      videoTextureRef.current.needsUpdate = true
    }
  })

  const aspectRatio = videoElement?.videoWidth && videoElement?.videoHeight
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
        displacementScale={0.2}
        displacementBias={-0.1}
      />
    </mesh>
  )
}

interface DepthSceneProps {
  videoElement: HTMLVideoElement | null
  depthResult: DepthResult | null
  filterMode: DepthFilterMode
}

export default function DepthScene({ videoElement, depthResult, filterMode }: DepthSceneProps) {
  return (
    <Canvas
      camera={{ fov: 50, near: 0.1, far: 100 }}
      style={{ background: '#000' }}
    >
      <ambientLight intensity={1.0} />
      <DepthMesh videoElement={videoElement} depthResult={depthResult} filterMode={filterMode} />
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
