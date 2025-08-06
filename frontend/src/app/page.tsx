"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const [roomId, setRoomId] = useState("");
  const router = useRouter();

  const createRoom = () => {
    const newRoomId = `room_${Math.random().toString(36).substring(2, 15)}`;
    router.push(`/stream?room=${newRoomId}`);
  };

  const joinRoom = () => {
    if (roomId.trim()) {
      router.push(`/stream?room=${roomId.trim()}`);
    }
  };

  const watchRoom = () => {
    if (roomId.trim()) {
      router.push(`/watch?room=${roomId.trim()}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center px-4">
      <div className="max-w-2xl w-full">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-6">Fermion Stream</h1>
          <p className="text-xl text-gray-300 mb-8">
            Real-time WebRTC streaming with HLS broadcasting
          </p>
          <div className="flex justify-center space-x-6 text-sm text-gray-400">
            <div className="flex items-center">
              <div className="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
              WebRTC P2P
            </div>
            <div className="flex items-center">
              <div className="w-2 h-2 bg-blue-400 rounded-full mr-2"></div>
              Mediasoup SFU
            </div>
            <div className="flex items-center">
              <div className="w-2 h-2 bg-purple-400 rounded-full mr-2"></div>
              HLS Broadcasting
            </div>
          </div>
        </div>

        {/* Main Actions */}
        <div className="bg-gray-800 rounded-xl p-8 shadow-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Start Streaming */}
            <div className="text-center">
              <div className="bg-red-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-white"
                  fill="currentColor"
                  viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-semibold text-white mb-2">
                Start Streaming
              </h2>
              <p className="text-gray-400 mb-6">
                Create a new room and start broadcasting with your camera and
                microphone
              </p>
              <button
                onClick={createRoom}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-lg transition-colors">
                Create New Room
              </button>
            </div>

            {/* Watch Stream */}
            <div className="text-center">
              <div className="bg-blue-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-white"
                  fill="currentColor"
                  viewBox="0 0 20 20">
                  <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                </svg>
              </div>
              <h2 className="text-2xl font-semibold text-white mb-2">
                Watch Stream
              </h2>
              <p className="text-gray-400 mb-6">
                Join as a viewer and watch live HLS streams from active rooms
              </p>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Enter room ID to watch"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={watchRoom}
                  disabled={!roomId.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-medium py-3 px-6 rounded-lg transition-colors">
                  Watch Stream
                </button>
              </div>
            </div>
          </div>

          {/* Join as Streamer */}
          <div className="mt-8 pt-8 border-t border-gray-700">
            <div className="text-center">
              <h3 className="text-lg font-medium text-white mb-4">
                Join Existing Room as Streamer
              </h3>
              <div className="flex gap-3 max-w-md mx-auto">
                <input
                  type="text"
                  placeholder="Enter room ID to join"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-green-500 focus:outline-none"
                />
                <button
                  onClick={joinRoom}
                  disabled={!roomId.trim()}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-medium py-2 px-6 rounded-lg transition-colors">
                  Join
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* How it Works */}
        <div className="mt-12 bg-gray-800/50 rounded-xl p-8">
          <h3 className="text-2xl font-semibold text-white text-center mb-8">
            How It Works
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="bg-red-600/20 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-red-400 font-bold text-lg">1</span>
              </div>
              <h4 className="text-white font-medium mb-2">WebRTC Streaming</h4>
              <p className="text-gray-400 text-sm">
                Streamers connect via WebRTC for real-time P2P communication
                using mediasoup SFU
              </p>
            </div>
            <div className="text-center">
              <div className="bg-blue-600/20 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-blue-400 font-bold text-lg">2</span>
              </div>
              <h4 className="text-white font-medium mb-2">HLS Transcoding</h4>
              <p className="text-gray-400 text-sm">
                FFMPEG converts WebRTC streams to HLS format for broader
                compatibility
              </p>
            </div>
            <div className="text-center">
              <div className="bg-green-600/20 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-green-400 font-bold text-lg">3</span>
              </div>
              <h4 className="text-white font-medium mb-2">Live Broadcasting</h4>
              <p className="text-gray-400 text-sm">
                Viewers watch the HLS stream with standard video players and
                controls
              </p>
            </div>
          </div>
        </div>

        {/* Technical Stack */}
        <div className="mt-8 text-center">
          <p className="text-gray-500 text-sm">
            Built with Next.js, Node.js, TypeScript, mediasoup, Socket.io, and
            FFMPEG
          </p>
        </div>
      </div>
    </div>
  );
}
