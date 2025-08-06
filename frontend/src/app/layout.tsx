import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Fermion WebRTC Streaming",
  description: "Real-time WebRTC streaming with HLS broadcasting",
  keywords: ["WebRTC", "streaming", "live", "HLS", "mediasoup"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className={`${inter.className} bg-gray-900 min-h-screen`}>
        <nav className="bg-gray-800 border-b border-gray-700">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <h1 className="text-xl font-bold text-white">Fermion Stream</h1>
                <div className="text-gray-400 text-sm">
                  WebRTC + HLS Broadcasting
                </div>
              </div>
              <div className="flex space-x-4">
                <a
                  href="/stream"
                  className="text-gray-300 hover:text-white transition-colors">
                  Stream
                </a>
                <a
                  href="/watch"
                  className="text-gray-300 hover:text-white transition-colors">
                  Watch
                </a>
              </div>
            </div>
          </div>
        </nav>
        <main>{children}</main>
        <footer className="bg-gray-800 border-t border-gray-700 mt-12">
          <div className="container mx-auto px-4 py-6 text-center text-gray-400 text-sm">
            <p>
              Built with Next.js, Node.js, mediasoup, and FFMPEG • WebRTC to HLS
              Streaming
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
