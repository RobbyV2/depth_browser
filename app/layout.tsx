export const metadata = {
  title: 'DepthXR Capture',
  description: 'Screen capture with WebXR depth mapping',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          *, *::before, *::after {
            box-sizing: border-box;
          }
          html, body {
            margin: 0;
            padding: 0;
            height: 100%;
            width: 100%;
            overflow: hidden;
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
