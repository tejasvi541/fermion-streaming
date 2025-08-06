"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
import { Device } from "mediasoup-client";
import type {
  Transport,
  Producer,
  Consumer,
  RtpCapabilities,
  IceParameters,
  DtlsParameters,
} from "mediasoup-client/types";

// --- Type Definitions ---
interface PeerInfo {
  id: string;
  videoConsumer?: Consumer;
  audioConsumer?: Consumer;
}

// --- Remote Peer Component ---
function RemotePeer({ peer }: { peer: PeerInfo }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (peer.videoConsumer && videoRef.current) {
      const stream = new MediaStream([peer.videoConsumer.track]);
      videoRef.current.srcObject = stream;
    }
    if (peer.audioConsumer && audioRef.current) {
      const stream = new MediaStream([peer.audioConsumer.track]);
      audioRef.current.srcObject = stream;
    }
  }, [peer.videoConsumer, peer.audioConsumer]);

  return (
    <div className="bg-gray-800 rounded-lg p-4 relative">
      <div className="absolute top-2 left-2 bg-black bg-opacity-70 px-2 py-1 rounded text-xs text-white z-10">
        Peer: {peer.id.substring(0, 8)}
      </div>
      <div className="aspect-video bg-gray-700 rounded overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      </div>
      <audio ref={audioRef} autoPlay />
    </div>
  );
}

// --- Main Stream Component ---
export default function StreamComponent({
  roomId,
  onConnectionChange,
}: {
  roomId: string;
  onConnectionChange: (c: boolean) => void;
}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [peers, setPeers] = useState<Map<string, PeerInfo>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const producersRef = useRef<Map<string, Producer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const SERVER_URL =
    process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

  const stopStreaming = useCallback(() => {
    // Stop all producers
    producersRef.current.forEach((producer) => producer.close());
    producersRef.current.clear();

    // Stop local stream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    // Clear video element
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    setIsStreaming(false);
  }, []);

  const startStreaming = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Create video producer
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const videoProducer = await sendTransportRef.current!.produce({
          track: videoTrack,
        });
        producersRef.current.set("video", videoProducer);
      }

      // Create audio producer
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const audioProducer = await sendTransportRef.current!.produce({
          track: audioTrack,
        });
        producersRef.current.set("audio", audioProducer);
      }

      setIsStreaming(true);
    } catch (err) {
      console.error("Failed to get media:", err);
      setError("Failed to access camera/microphone. Please check permissions.");
    }
  }, []);

  const setupTransports = useCallback(
    (socket: Socket, device: Device, roomId: string) => {
      // Create send transport
      socket.emit(
        "create-transport",
        { roomId, peerId: socket.id },
        (res: {
          success: boolean;
          id: string;
          iceParameters: IceParameters;
          iceCandidates: mediasoupClient.types.IceCandidate[];
          dtlsParameters: DtlsParameters;
        }) => {
          if (!res.success) {
            setError("Failed to create send transport");
            return;
          }

          const sendTransport = device.createSendTransport(res);

          sendTransport.on(
            "connect",
            ({ dtlsParameters }, callback, errback) => {
              socket.emit(
                "connect-transport",
                { roomId, transportId: sendTransport.id, dtlsParameters },
                (response: { success: boolean }) => {
                  if (response.success) callback();
                  else errback(new Error("Failed to connect send transport"));
                }
              );
            }
          );

          sendTransport.on(
            "produce",
            ({ kind, rtpParameters }, callback, errback) => {
              socket.emit(
                "produce",
                { roomId, transportId: sendTransport.id, kind, rtpParameters },
                (response: {
                  success: boolean;
                  producerId?: string;
                  error?: string;
                }) => {
                  if (response.success && response.producerId) {
                    callback({ id: response.producerId });
                  } else {
                    errback(new Error(response.error || "Failed to produce"));
                  }
                }
              );
            }
          );

          sendTransportRef.current = sendTransport;
        }
      );

      // Create receive transport
      socket.emit(
        "create-transport",
        { roomId, peerId: socket.id },
        (res: {
          success: boolean;
          id: string;
          iceParameters: IceParameters;
          iceCandidates: mediasoupClient.types.IceCandidate[];
          dtlsParameters: DtlsParameters;
        }) => {
          if (!res.success) {
            setError("Failed to create receive transport");
            return;
          }

          const recvTransport = device.createRecvTransport(res);

          recvTransport.on(
            "connect",
            ({ dtlsParameters }, callback, errback) => {
              socket.emit(
                "connect-transport",
                { roomId, transportId: recvTransport.id, dtlsParameters },
                (response: { success: boolean }) => {
                  if (response.success) callback();
                  else
                    errback(new Error("Failed to connect receive transport"));
                }
              );
            }
          );

          recvTransportRef.current = recvTransport;
        }
      );
    },
    []
  );

  const connect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const socket = io(SERVER_URL, {
      forceNew: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Connected to server");
      setIsConnected(true);
      onConnectionChange(true);
      setError(null);

      socket.emit(
        "join-room",
        { roomId, isStreamer: true },
        async (res: {
          success: boolean;
          rtpCapabilities?: RtpCapabilities;
          error?: string;
        }) => {
          if (!res.success || !res.rtpCapabilities) {
            setError(res.error || "Failed to join room");
            return;
          }

          try {
            const device = new mediasoupClient.Device();
            await device.load({ routerRtpCapabilities: res.rtpCapabilities });
            deviceRef.current = device;

            setupTransports(socket, device, roomId);
          } catch (error) {
            console.error("Failed to load device:", error);
            setError("Failed to initialize media device");
          }
        }
      );
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from server");
      setIsConnected(false);
      onConnectionChange(false);
      stopStreaming();
    });

    socket.on("connect_error", (error) => {
      console.error("Connection error:", error);
      setError("Failed to connect to server");
    });

    socket.on("new-producer", ({ peerId, producerId }) => {
      console.log("New producer:", peerId, producerId);

      if (!recvTransportRef.current || !deviceRef.current) {
        console.warn("Transport or device not ready");
        return;
      }

      socket.emit(
        "consume",
        {
          roomId,
          transportId: recvTransportRef.current.id,
          producerId,
          rtpCapabilities: deviceRef.current.rtpCapabilities,
        },
        async (res: {
          success: boolean;
          id?: string;
          producerId?: string;
          kind?: string;
          rtpParameters?: unknown;
          error?: string;
        }) => {
          if (!res.success || !res.id || !res.rtpParameters) {
            console.error("Failed to consume:", res.error);
            return;
          }

          try {
            const consumer = await recvTransportRef.current!.consume({
              id: res.id,
              producerId: res.producerId!,
              kind: res.kind as "audio" | "video",
              rtpParameters: {
                codecs: [],
                ...res.rtpParameters,
              },
            });

            socket.emit("resume-consumer", { roomId, consumerId: consumer.id });

            setPeers((prev) => {
              const newPeers = new Map(prev);
              const prevPeerInfo = newPeers.get(peerId);
              const peerInfo = {
                id: peerId,
                ...(prevPeerInfo || {}),
                ...(consumer.kind === "video"
                  ? { videoConsumer: consumer }
                  : { audioConsumer: consumer }),
              };

              newPeers.set(peerId, peerInfo);
              return newPeers;
            });
          } catch (error) {
            console.error("Failed to create consumer:", error);
          }
        }
      );
    });

    socket.on("peer-left", ({ peerId }) => {
      console.log("Peer left:", peerId);
      setPeers((prev) => {
        const newPeers = new Map(prev);
        const peerInfo = newPeers.get(peerId);

        // Close consumers
        if (peerInfo?.videoConsumer) peerInfo.videoConsumer.close();
        if (peerInfo?.audioConsumer) peerInfo.audioConsumer.close();

        newPeers.delete(peerId);
        return newPeers;
      });
    });
  }, [roomId, SERVER_URL, onConnectionChange, stopStreaming, setupTransports]);

  useEffect(() => {
    connect();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      stopStreaming();
    };
  }, [connect, stopStreaming]);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Connection Status & Controls */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-white">Stream Controls</h2>
          <div
            className={`flex items-center space-x-2 ${
              isConnected ? "text-green-400" : "text-red-400"
            }`}>
            <div
              className={`w-3 h-3 rounded-full ${
                isConnected ? "bg-green-400" : "bg-red-400"
              }`}
            />
            <span className="text-sm">
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded mb-4">
            {error}
          </div>
        )}

        <div className="flex gap-4">
          <button
            onClick={startStreaming}
            disabled={isStreaming || !isConnected}
            className="bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white px-6 py-2 rounded-lg font-medium duration-200">
            {isStreaming ? "Streaming..." : "Start Streaming"}
          </button>
          <button
            onClick={stopStreaming}
            disabled={!isStreaming}
            className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 text-white px-6 py-2 rounded-lg font-medium duration-200">
            Stop Streaming
          </button>
        </div>

        <div className="mt-4 text-sm text-gray-400">
          Connected Peers: {peers.size} | Streaming:{" "}
          {isStreaming ? "Yes" : "No"}
        </div>
      </div>

      {/* Video Grid - Horizontal Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Local Video */}
        <div className="bg-gray-800 rounded-lg p-4 relative">
          <div className="absolute top-2 left-2 bg-blue-600 bg-opacity-90 px-2 py-1 rounded text-xs text-white z-10">
            You (Local)
          </div>
          <div className="aspect-video bg-gray-700 rounded overflow-hidden">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Remote Peers */}
        {Array.from(peers.values()).map((peer) => (
          <RemotePeer key={peer.id} peer={peer} />
        ))}
      </div>

      {/* Info Panel */}
      <div className="bg-gray-800 rounded-lg p-6 mt-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Stream Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-400">Room ID:</span>
            <span className="text-white ml-2 font-mono">{roomId}</span>
          </div>
          <div>
            <span className="text-gray-400">Status:</span>
            <span
              className={`ml-2 ${
                isStreaming ? "text-green-400" : "text-gray-400"
              }`}>
              {isStreaming ? "Live" : "Offline"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
