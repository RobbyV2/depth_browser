'use client'

import { useState } from 'react'

export default function Home() {
  const [apiResponse, setApiResponse] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const testApi = async (endpoint: string) => {
    setLoading(true)
    try {
      const response = await fetch(endpoint)
      const data = await response.json()
      setApiResponse(data)
    } catch (error) {
      setApiResponse({ error: 'Failed to fetch' })
    }
    setLoading(false)
  }

  // Environment variables in Next.js
  const nextjsPublicVar = process.env.NEXT_PUBLIC_API_URL

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Next.js + Rust API</h1>
      <p>Test the Rust backend API endpoints:</p>

      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => testApi('/api/hello')}
          style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
        >
          Test /api/hello
        </button>
        <button
          onClick={() => testApi('/api/greet/World')}
          style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
        >
          Test /api/greet/World
        </button>
        <button
          onClick={() => testApi('/api/search?q=rust')}
          style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
        >
          Test /api/search?q=rust
        </button>
        <button
          onClick={() => testApi('/api/env')}
          style={{ padding: '0.5rem 1rem', cursor: 'pointer', backgroundColor: '#e0f2fe' }}
        >
          Test /api/env (Environment Variables)
        </button>
      </div>

      <div
        style={{
          marginTop: '2rem',
          padding: '1rem',
          backgroundColor: '#fef3c7',
          borderRadius: '4px',
          fontSize: '0.9rem',
        }}
      >
        <strong>Next.js Environment Variable:</strong>
        <br />
        NEXT_PUBLIC_API_URL = {nextjsPublicVar || 'not set'}
      </div>

      {loading && <p style={{ marginTop: '2rem' }}>Loading...</p>}

      {apiResponse && !loading && (
        <div
          style={{
            marginTop: '2rem',
            padding: '1rem',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            fontFamily: 'monospace',
          }}
        >
          <h3>Response:</h3>
          <pre>{JSON.stringify(apiResponse, null, 2)}</pre>
        </div>
      )}
    </main>
  )
}
