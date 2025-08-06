"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import Hls from "hls.js";

// --- Type Definitions for Server Responses ---
interface GetHlsUrlResponse {
  success: boolean;
  hlsUrl?: string;
  error?: string;
}

interface StreamStats {
  roomId: string;
  peers: number;
  transports: number;
  producers: number;
  consumers: number;
  hasHLS: boolean;
}

interface GetRoomStatsResponse {
  success: boolean;
  stats?: StreamStats;
  error?: string;
}

// --- Main Watch Component ---
interface WatchComponentProps {
  roomId: string;
}

export default function WatchComponent({ roomId }: WatchComponentProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [streamAvailable, setStreamAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const SERVER_URL =
    process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

  const cleanupHLS = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = "";
    }
  }, []);

  const loadHLSStream = useCallback(() => {
    if (!socketRef.current || !videoRef.current) return;

    console.log("Attempting to load HLS stream...");

    socketRef.current.emit(
      "get-hls-url",
      { roomId },
      (response: GetHlsUrlResponse) => {
        console.log("HLS URL response:", response);

        if (response.success && response.hlsUrl) {
          const hlsUrl = `${SERVER_URL}${response.hlsUrl}`;
          console.log("Loading HLS stream from:", hlsUrl);

          // Clean up existing HLS instance
          cleanupHLS();

          if (Hls.isSupported()) {
            const hls = new Hls({
              lowLatencyMode: false,
              enableWorker: true,
              maxBufferLength: 10,
              maxMaxBufferLength: 20,
              startFragPrefetch: true,
            });

            hls.loadSource(hlsUrl);
            hls.attachMedia(videoRef.current!);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              console.log("HLS manifest parsed successfully");
              setStreamAvailable(true);
              setIsLoading(false);
              setError(null);
              setRetryCount(0);

              // Auto-play with error handling
              videoRef.current?.play().catch((err) => {
                console.warn("Auto-play failed:", err);
                // Don't set this as an error, user can manually play
              });
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
              console.error("HLS error:", { event, data });

              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log("Network error, trying to recover...");
                    setError("Network error. Retrying...");
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log("Media error, trying to recover...");
                    hls.recoverMediaError();
                    break;
                  default:
                    console.log("Fatal error, cannot recover");
                    setError(
                      "Stream playback failed. Please refresh the page."
                    );
                    hls.destroy();
                    break;
                }
              }
            });

            hls.on(Hls.Events.FRAG_LOADED, () => {
              // Stream is actively loading fragments
              if (!streamAvailable) {
                setStreamAvailable(true);
                setIsLoading(false);
                setError(null);
              }
            });

            hlsRef.current = hls;
          } else if (
            videoRef.current &&
            videoRef.current.canPlayType("application/vnd.apple.mpegurl")
          ) {
            // Native HLS support (Safari)
            videoRef.current.src = hlsUrl;

            const handleLoadedMetadata = () => {
              console.log("Native HLS stream loaded");
              setStreamAvailable(true);
              setIsLoading(false);
              setError(null);
              setRetryCount(0);
            };

            const handleError = () => {
              console.error("Native HLS error");
              setError("Stream playback failed. Please try again.");
            };

            videoRef.current.addEventListener(
              "loadedmetadata",
              handleLoadedMetadata
            );
            videoRef.current.addEventListener("error", handleError);

            // Cleanup listeners
            return () => {
              if (videoRef.current) {
                videoRef.current.removeEventListener(
                  "loadedmetadata",
                  handleLoadedMetadata
                );
                videoRef.current.removeEventListener("error", handleError);
              }
            };
          } else {
            setError("HLS is not supported in this browser");
            setIsLoading(false);
          }
        } else {
          console.log("HLS stream not available:", response.error);
          const newRetryCount = retryCount + 1;
          setRetryCount(newRetryCount);

          if (newRetryCount < 20) {
            // Retry for up to 100 seconds
            setError(`Stream not ready yet... (${newRetryCount}/20)`);
            setIsLoading(true);

            // Progressive retry delay: start with 5s, max 10s
            const delay = Math.min(5000 + newRetryCount * 500, 10000);

            if (retryTimeoutRef.current) {
              clearTimeout(retryTimeoutRef.current);
            }

            retryTimeoutRef.current = setTimeout(() => {
              if (socketRef.current?.connected) {
                loadHLSStream();
              }
            }, delay);
          } else {
            setError(
              "Stream is not available. The room may be empty or streamers haven't started yet."
            );
            setIsLoading(false);
          }
        }
      }
    );
  }, [roomId, SERVER_URL, cleanupHLS, retryCount]);

  const refreshStats = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(
        "get-room-stats",
        { roomId },
        (response: GetRoomStatsResponse) => {
          if (response.success && response.stats) {
            setStats(response.stats);
          }
        }
      );
    }
  }, [roomId]);

  const connectToServer = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    console.log("Connecting to server...");
    const socket = io(SERVER_URL, {
      forceNew: false,
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Connected to server as viewer");
      setIsConnected(true);
      setError(null);

      // Join the room as a viewer (non-streamer)
      socket.emit(
        "join-room",
        { roomId, isStreamer: false },
        (response: { success: boolean; error?: string }) => {
          if (response.success) {
            console.log("Successfully joined room as viewer");
            // Start attempting to load the stream
            loadHLSStream();
          } else {
            console.error("Failed to join room:", response.error);
            setError("Failed to join the room: " + response.error);
            setIsLoading(false);
          }
        }
      );
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from server");
      setIsConnected(false);
      setStreamAvailable(false);
      cleanupHLS();
      setError("Disconnected from server");
    });

    socket.on("connect_error", (err) => {
      console.error("Connection error:", err);
      setError("Failed to connect to the server");
      setIsLoading(false);
    });

    // Listen for room updates that might indicate stream availability
    socket.on("peer-joined", ({ peerId, isStreamer }) => {
      console.log("Peer joined:", peerId, "isStreamer:", isStreamer);
      if (isStreamer) {
        // A streamer joined, try loading stream after a short delay
        setTimeout(() => {
          loadHLSStream();
        }, 2000);
      }
    });

    socket.on("peer-left", ({ peerId }) => {
      console.log("Peer left:", peerId);
      // Refresh stats to see if stream is still available
      setTimeout(() => {
        refreshStats();
      }, 1000);
    });
  }, [SERVER_URL, roomId, loadHLSStream, cleanupHLS, refreshStats]);

  useEffect(() => {
    connectToServer();

    // Refresh stats every 5 seconds
    const statsInterval = setInterval(refreshStats, 5000);

    return () => {
      // Cleanup
      clearInterval(statsInterval);
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      cleanupHLS();
    };
  }, [connectToServer, refreshStats, cleanupHLS]);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Connection Status */}
      <div className="bg-gray-800 rounded-lg p-4 mb-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div
              className={`w-3 h-3 rounded-full ${
                isConnected ? "bg-green-400" : "bg-red-400"
              }`}
            />
            <span className="text-white text-sm">
              {isConnected ? "Connected to Server" : "Disconnected"}
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <div
              className={`flex items-center space-x-2 ${
                streamAvailable ? "text-green-400" : "text-red-400"
              }`}>
              <div
                className={`w-2 h-2 rounded-full ${
                  streamAvailable ? "bg-green-400 animate-pulse" : "bg-red-400"
                }`}
              />
              <span className="text-sm font-medium">
                {streamAvailable ? "LIVE" : "OFFLINE"}
              </span>
            </div>
            {retryCount > 0 && (
              <span className="text-yellow-400 text-sm">
                Retry {retryCount}/20
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Video Player */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6">
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          {(isLoading || error) && (
            <div className="absolute inset-0 flex items-center justify-center text-center z-10 bg-black bg-opacity-75">
              <div>
                {isLoading && !error && (
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                )}
                <p className="text-white text-lg mb-2">
                  {error || "Loading stream..."}
                </p>
                <p className="text-gray-400 text-sm">
                  {isLoading && !error
                    ? "Waiting for streamers to start broadcasting..."
                    : error?.includes("not available")
                    ? "Make sure streamers are in the room and have started streaming."
                    : "Please check your connection and try refreshing."}
                </p>
                {retryCount > 0 && (
                  <p className="text-yellow-400 text-xs mt-2">
                    Automatically retrying... ({retryCount}/20)
                  </p>
                )}
              </div>
            </div>
          )}
          <video
            ref={videoRef}
            controls
            autoPlay={false}
            playsInline
            className={`w-full h-full object-contain ${
              streamAvailable ? "block" : "hidden"
            }`}
            poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23374151'/%3E%3C/svg%3E"
          />
        </div>

        {streamAvailable && (
          <div className="mt-4 flex justify-between items-center">
            <div className="text-green-400 text-sm">🔴 Live Stream Active</div>
            <button
              onClick={() => {
                setRetryCount(0);
                loadHLSStream();
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm duration-200">
              Refresh Stream
            </button>
          </div>
        )}
      </div>

      {/* Room Statistics */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-xl font-semibold text-white mb-4">
          Room Statistics
        </h3>
        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div className="bg-gray-700 rounded p-3">
              <div className="text-gray-400">Active Streamers</div>
              <div className="text-white font-bold text-xl">{stats.peers}</div>
            </div>
            <div className="bg-gray-700 rounded p-3">
              <div className="text-gray-400">Media Producers</div>
              <div className="text-white font-bold text-xl">
                {stats.producers}
              </div>
            </div>
            <div className="bg-gray-700 rounded p-3">
              <div className="text-gray-400">HLS Stream</div>
              <div
                className={`font-bold text-xl ${
                  stats.hasHLS ? "text-green-400" : "text-red-400"
                }`}>
                {stats.hasHLS ? "Active" : "Inactive"}
              </div>
            </div>
            <div className="bg-gray-700 rounded p-3">
              <div className="text-gray-400">Transports</div>
              <div className="text-white font-bold text-xl">
                {stats.transports}
              </div>
            </div>
            <div className="bg-gray-700 rounded p-3">
              <div className="text-gray-400">Consumers</div>
              <div className="text-white font-bold text-xl">
                {stats.consumers}
              </div>
            </div>
            <div className="bg-gray-700 rounded p-3">
              <div className="text-gray-400">Room ID</div>
              <div className="text-white font-mono text-xs">{stats.roomId}</div>
            </div>
          </div>
        ) : (
          <div className="text-gray-400 text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-2"></div>
            Loading room statistics...
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-700">
          <div className="flex justify-between items-center text-sm text-gray-400">
            <span>Last updated: {new Date().toLocaleTimeString()}</span>
            <button
              onClick={refreshStats}
              className="text-blue-400 hover:text-blue-300 duration-200">
              Refresh Stats
            </button>
          </div>
        </div>
      </div>

      {/* Help Section */}
      <div className="mt-6 bg-gray-800/50 rounded-lg p-6">
        <h4 className="text-lg font-medium text-white mb-3">Troubleshooting</h4>
        <div className="text-sm text-gray-400 space-y-2">
          <p>
            • Make sure streamers are in the room and have started their cameras
          </p>
          <p>
            • The stream needs at least 2 active streamers to generate HLS
            output
          </p>
          <p>• If the stream doesnt load, try refreshing the page</p>
          <p>
            • HLS streams have a 5-10 second delay compared to real-time WebRTC
          </p>
        </div>
      </div>
    </div>
  );
}
