"use client";

import { useEffect, useState } from "react";
import StreamComponent from "@/components/StreamComponent";

export default function StreamPage() {
  const [roomId, setRoomId] = useState<string>("");
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Generate or get room ID from URL params
    const params = new URLSearchParams(window.location.search);
    let room = params.get("room");

    if (!room) {
      room = `room_${Math.random().toString(36).substring(2, 15)}`;
      const newUrl = `${window.location.pathname}?room=${room}`;
      window.history.replaceState({}, "", newUrl);
    }

    setRoomId(room);
  }, []);

  if (!roomId) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-4">
            Live Stream Room
          </h1>
          <div className="bg-gray-800 rounded-lg p-4 inline-block">
            <p className="text-gray-300 text-sm mb-2">Room ID:</p>
            <p className="text-white font-mono text-lg">{roomId}</p>
          </div>
          <div className="mt-4">
            <div
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                isConnected
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-800"
              }`}>
              <div
                className={`w-2 h-2 rounded-full mr-2 ${
                  isConnected ? "bg-green-500" : "bg-red-500"
                }`}
              />
              {isConnected ? "Connected" : "Disconnected"}
            </div>
          </div>
        </div>

        <StreamComponent roomId={roomId} onConnectionChange={setIsConnected} />

        <div className="mt-8 text-center">
          <div className="bg-gray-800 rounded-lg p-6 max-w-2xl mx-auto">
            <h2 className="text-xl font-semibold text-white mb-4">
              Share Your Stream
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-300 text-sm mb-2">
                  Stream URL (for other streamers):
                </label>
                <div className="bg-gray-700 rounded p-3 text-white font-mono text-sm break-all">
                  {window.location.href}
                </div>
              </div>
              <div>
                <label className="block text-gray-300 text-sm mb-2">
                  Watch URL (for viewers):
                </label>
                <div className="bg-gray-700 rounded p-3 text-white font-mono text-sm break-all">
                  {window.location.origin}/watch?room={roomId}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
