export const metadata = {
  title: 'Next.js + Rust API',
  description: 'Next.js frontend with Rust backend',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
