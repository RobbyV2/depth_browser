'use client'

import { useState, useEffect } from 'react'

type WasmModule = {
  greet: (name: string) => string
  add: (a: number, b: number) => number
  default(path?: string): Promise<void>
}

export default function WasmPage() {
  const [wasm, setWasm] = useState<WasmModule | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [greeting, setGreeting] = useState<string>('')
  const [sum, setSum] = useState<number | null>(null)

  useEffect(() => {
    async function loadWasm() {
      try {
        const wasmModule = (await import(
          /* webpackIgnore: true */ '/wasm/rust_next_wasm.js'
        )) as unknown as WasmModule

        await wasmModule.default('/wasm/rust_next_wasm_bg.wasm')
        setWasm(wasmModule)
        setLoading(false)
      } catch (err) {
        console.error('WASM load error:', err)
        setError(`Failed to load WASM: ${err}`)
        setLoading(false)
      }
    }

    loadWasm()
  }, [])

  const handleGreet = () => {
    if (wasm) {
      const result = wasm.greet('World')
      setGreeting(result)
    }
  }

  const handleAdd = () => {
    if (wasm) {
      const result = wasm.add(40, 2)
      setSum(result)
    }
  }

  if (loading) {
    return (
      <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        <h1>Rust WASM Demo</h1>
        <p>Loading WASM module...</p>
      </main>
    )
  }

  if (error) {
    return (
      <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        <h1>Rust WASM Demo</h1>
        <p style={{ color: 'red' }}>{error}</p>
        <p style={{ marginTop: '1rem' }}>
          Make sure to build WASM first:
          <code
            style={{
              display: 'block',
              backgroundColor: '#f5f5f5',
              padding: '0.5rem',
              marginTop: '0.5rem',
              borderRadius: '4px',
            }}
          >
            just src build-wasm
          </code>
        </p>
      </main>
    )
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
        Rust WASM Demo
      </h1>
      <p style={{ marginBottom: '2rem' }}>WASM module loaded successfully!</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div style={{ padding: '1.5rem', border: '1px solid #ccc', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem' }}>
            Greet Function
          </h2>
          <button
            onClick={handleGreet}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
          >
            Call greet(&quot;World&quot;)
          </button>
          {greeting && (
            <p style={{ marginTop: '1rem', color: '#16a34a', fontWeight: '500' }}>
              Result: {greeting}
            </p>
          )}
        </div>

        <div style={{ padding: '1.5rem', border: '1px solid #ccc', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem' }}>
            Add Function
          </h2>
          <button
            onClick={handleAdd}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#22c55e',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Call add(40, 2)
          </button>
          {sum !== null && (
            <p style={{ marginTop: '1rem', color: '#16a34a', fontWeight: '500' }}>Result: {sum}</p>
          )}
        </div>
      </div>
    </main>
  )
}
