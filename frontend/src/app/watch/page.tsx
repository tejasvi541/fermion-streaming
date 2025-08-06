"use client";

import { useEffect, useState } from "react";
import WatchComponent from "@/components/WatchComponent";

export default function WatchPage() {
  const [roomId, setRoomId] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");

    if (room) {
      setRoomId(room);
    } else {
      // Redirect to home or show error
      console.error("No room ID provided");
    }
  }, []);

  if (!roomId) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">
            No Room Specified
          </h1>
          <p className="text-gray-400 mb-6">
            Please provide a room ID in the URL parameters.
          </p>
          <p className="text-gray-500 text-sm">
            Example: /watch?room=your_room_id
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-4">
            Live Stream Viewer
          </h1>
          <div className="bg-gray-800 rounded-lg p-4 inline-block">
            <p className="text-gray-300 text-sm mb-2">Watching Room:</p>
            <p className="text-white font-mono text-lg">{roomId}</p>
          </div>
        </div>

        <WatchComponent roomId={roomId} />

        <div className="mt-8 text-center">
          <div className="bg-gray-800 rounded-lg p-6 max-w-xl mx-auto">
            <h2 className="text-xl font-semibold text-white mb-4">
              Stream Information
            </h2>
            <p className="text-gray-300 text-sm">
              You are watching a live HLS stream. The video may take a few
              seconds to load and there might be a small delay compared to the
              live interaction.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
