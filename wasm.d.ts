// Type declarations for WASM module loaded from public directory
// This allows TypeScript to recognize the dynamic import

declare module '*/wasm/rust_next_wasm.js' {
  export function greet(name: string): string
  export function add(a: number, b: number): number
  export default function init(path?: string): Promise<void>
}
