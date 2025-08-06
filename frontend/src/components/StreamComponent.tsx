"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
import { Device } from "mediasoup-client";
import type {
  Transport,
  Producer,
  Consumer,
  MediaKind,
  RtpCapabilities,
  DtlsParameters,
  IceCandidate,
  IceParameters,
  RtpParameters,
} from "mediasoup-client/types";

// --- Type Definitions for Server Responses ---
interface JoinRoomResponse {
  success: boolean;
  rtpCapabilities?: RtpCapabilities;
  error?: string;
}

interface CreateTransportResponse {
  success: boolean;
  id?: string;
  iceParameters?: IceParameters;
  iceCandidates?: IceCandidate[];
  dtlsParameters?: DtlsParameters;
  error?: string;
}

interface ProduceResponse {
  success: boolean;
  producerId?: string;
  error?: string;
}

interface ConsumeResponse {
  success: boolean;
  id?: string;
  producerId?: string;
  kind?: MediaKind;
  rtpParameters?: RtpParameters;
  error?: string;
}

// --- Remote Peer Component ---
function RemotePeer({ peer }: { peer: PeerInfo }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (peer.videoConsumer && videoRef.current) {
      const videoStream = new MediaStream([peer.videoConsumer.track]);
      videoRef.current.srcObject = videoStream;
    }
    if (peer.audioConsumer && audioRef.current) {
      const audioStream = new MediaStream([peer.audioConsumer.track]);
      audioRef.current.srcObject = audioStream;
    }
  }, [peer.videoConsumer, peer.audioConsumer]);

  return (
    <div className="bg-gray-800 rounded-lg p-4 relative">
      <h3 className="text-white font-medium mb-2 absolute top-2 left-2 bg-black bg-opacity-50 px-2 py-1 rounded">
        Peer: {peer.id.substring(0, 6)}
      </h3>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-auto rounded-lg bg-gray-700"
      />
      <audio ref={audioRef} autoPlay />
    </div>
  );
}

// --- Main Stream Component ---
interface StreamComponentProps {
  roomId: string;
  onConnectionChange: (connected: boolean) => void;
}

interface PeerInfo {
  id: string;
  videoConsumer?: Consumer;
  audioConsumer?: Consumer;
}

export default function StreamComponent({
  roomId,
  onConnectionChange,
}: StreamComponentProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const [hasMicrophone, setHasMicrophone] = useState(false);
  const [peers, setPeers] = useState<Map<string, PeerInfo>>(new Map());

  const socketRef = useRef<Socket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const producersRef = useRef<Map<string, Producer>>(new Map());
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const SERVER_URL =
    process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

  const stopStreaming = useCallback(() => {
    if (isStreaming) {
      console.log("Stopping streaming...");
      producersRef.current.forEach((producer) => producer.close());
      producersRef.current.clear();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      setIsStreaming(false);
    }
  }, [isStreaming]);

  const consumeMedia = useCallback(
    async (producerId: string, peerId: string) => {
      if (!recvTransportRef.current || !deviceRef.current || !socketRef.current)
        return;

      console.log(
        `Attempting to consume producer ${producerId} from peer ${peerId}`
      );
      socketRef.current.emit(
        "consume",
        {
          roomId,
          transportId: recvTransportRef.current.id,
          producerId,
          rtpCapabilities: deviceRef.current.rtpCapabilities,
        },
        async (response: ConsumeResponse) => {
          if (
            response.success &&
            response.id &&
            response.producerId &&
            response.kind &&
            response.rtpParameters
          ) {
            const consumer = await recvTransportRef.current!.consume({
              id: response.id,
              producerId: response.producerId,
              kind: response.kind,
              rtpParameters: response.rtpParameters,
            });

            socketRef.current?.emit("resume-consumer", {
              roomId,
              consumerId: consumer.id,
            });

            setPeers((prevPeers) => {
              const newPeers = new Map(prevPeers);
              const peer = newPeers.get(peerId) || { id: peerId };

              if (consumer.kind === "video") {
                peer.videoConsumer = consumer;
              } else if (consumer.kind === "audio") {
                peer.audioConsumer = consumer;
              }

              newPeers.set(peerId, peer);
              return newPeers;
            });

            console.log(
              `Successfully created consumer for ${consumer.kind} from peer ${peerId}`
            );
          } else {
            console.error("Failed to create consumer:", response.error);
          }
        }
      );
    },
    [roomId]
  );

  const connectToServer = useCallback(async () => {
    console.log("Connecting to server...");
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    const handleNewProducer = async (data: {
      producerId: string;
      peerId: string;
    }) => {
      if (data.peerId !== socket.id) {
        console.log(`Received new producer from peer ${data.peerId}`);
        await consumeMedia(data.producerId, data.peerId);
      }
    };

    const handlePeerLeft = (data: { peerId: string }) => {
      console.log(`Peer left: ${data.peerId}`);
      setPeers((prevPeers) => {
        const newPeers = new Map(prevPeers);
        newPeers.delete(data.peerId);
        return newPeers;
      });
    };

    socket.on("connect", () => {
      console.log("Connected to server");
      setIsConnected(true);
      onConnectionChange(true);

      socket.emit(
        "join-room",
        { roomId, isStreamer: true },
        async (response: JoinRoomResponse) => {
          if (response.success && response.rtpCapabilities) {
            console.log("Joined room successfully");
            const device = new mediasoupClient.Device();
            await device.load({
              routerRtpCapabilities: response.rtpCapabilities,
            });
            deviceRef.current = device;
            console.log("Mediasoup device loaded");
          } else {
            console.error("Failed to join room:", response.error);
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

    socket.on("new-producer", handleNewProducer);
    socket.on("peer-left", handlePeerLeft);

    return () => {
      socket.off("new-producer", handleNewProducer);
      socket.off("peer-left", handlePeerLeft);
    };
  }, [roomId, SERVER_URL, consumeMedia, stopStreaming, onConnectionChange]);

  const createTransports = useCallback(async () => {
    if (!socketRef.current || !deviceRef.current) return;

    const createTransport = (
      direction: "send" | "recv"
    ): Promise<Transport> => {
      return new Promise((resolve, reject) => {
        socketRef.current!.emit(
          "create-transport",
          { roomId },
          (response: CreateTransportResponse) => {
            if (response.success) {
              const transportOptions = {
                id: response.id!,
                iceParameters: response.iceParameters!,
                iceCandidates: response.iceCandidates!,
                dtlsParameters: response.dtlsParameters!,
              };
              const transport =
                direction === "send"
                  ? deviceRef.current!.createSendTransport(transportOptions)
                  : deviceRef.current!.createRecvTransport(transportOptions);

              transport.on(
                "connect",
                ({ dtlsParameters }, callback, errback) => {
                  socketRef.current!.emit(
                    "connect-transport",
                    { roomId, transportId: transport.id, dtlsParameters },
                    (res: { success: boolean }) => {
                      if (res.success) callback();
                      else errback(new Error("Transport connection failed"));
                    }
                  );
                }
              );

              if (direction === "send") {
                transport.on(
                  "produce",
                  async (
                    { kind, rtpParameters, appData },
                    callback,
                    errback
                  ) => {
                    socketRef.current!.emit(
                      "produce",
                      {
                        roomId,
                        transportId: transport.id,
                        kind,
                        rtpParameters,
                        appData,
                      },
                      (res: ProduceResponse) => {
                        if (res.success && res.producerId)
                          callback({ id: res.producerId });
                        else errback(new Error("Produce failed"));
                      }
                    );
                  }
                );
              }
              resolve(transport);
            } else {
              reject(
                new Error(
                  `Failed to create ${direction} transport: ${response.error}`
                )
              );
            }
          }
        );
      });
    };

    try {
      sendTransportRef.current = await createTransport("send");
      recvTransportRef.current = await createTransport("recv");
      console.log("Send and receive transports created");
    } catch (error) {
      console.error("Error creating transports:", error);
    }
  }, [roomId]);

  const startStreaming = useCallback(async () => {
    if (!hasCamera && !hasMicrophone) {
      alert("Please enable camera or microphone to start streaming.");
      return;
    }

    try {
      if (!sendTransportRef.current || !recvTransportRef.current) {
        await createTransports();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: hasCamera,
        audio: hasMicrophone,
      });
      localStreamRef.current = stream;

      if (localVideoRef.current && hasCamera) {
        localVideoRef.current.srcObject = stream;
      }

      if (hasCamera) {
        const videoTrack = stream.getVideoTracks()[0];
        const videoProducer = await sendTransportRef.current!.produce({
          track: videoTrack,
        });
        producersRef.current.set("video", videoProducer);
      }
      if (hasMicrophone) {
        const audioTrack = stream.getAudioTracks()[0];
        const audioProducer = await sendTransportRef.current!.produce({
          track: audioTrack,
        });
        producersRef.current.set("audio", audioProducer);
      }

      setIsStreaming(true);
      console.log("Streaming started");
    } catch (error) {
      console.error("Failed to start streaming:", error);
    }
  }, [hasCamera, hasMicrophone, createTransports]);

  useEffect(() => {
    connectToServer();
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      stopStreaming();
    };
  }, [connectToServer, stopStreaming]);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="bg-gray-900 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold text-white mb-4">
          Stream Controls
        </h2>
        <div className="flex flex-wrap gap-4 mb-4">
          <label className="flex items-center text-white cursor-pointer">
            <input
              type="checkbox"
              checked={hasCamera}
              onChange={(e) => setHasCamera(e.target.checked)}
              disabled={isStreaming}
              className="mr-2 h-4 w-4"
            />
            Enable Camera
          </label>
          <label className="flex items-center text-white cursor-pointer">
            <input
              type="checkbox"
              checked={hasMicrophone}
              onChange={(e) => setHasMicrophone(e.target.checked)}
              disabled={isStreaming}
              className="mr-2 h-4 w-4"
            />
            Enable Microphone
          </label>
        </div>
        <div className="flex gap-4">
          {!isStreaming ? (
            <button
              onClick={startStreaming}
              disabled={!isConnected || (!hasCamera && !hasMicrophone)}
              className="bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white px-6 py-2 rounded-lg font-medium transition-colors">
              Start Streaming
            </button>
          ) : (
            <button
              onClick={stopStreaming}
              className="bg-gray-600 hover:bg-gray-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
              Stop Streaming
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {hasCamera && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-medium mb-2">You (Local)</h3>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-auto rounded-lg bg-gray-700"
            />
          </div>
        )}
        {Array.from(peers.values()).map((peer) => (
          <RemotePeer key={peer.id} peer={peer} />
        ))}
      </div>
    </div>
  );
}
