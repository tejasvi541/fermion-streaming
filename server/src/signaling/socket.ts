import { Server as SocketIOServer, Socket } from "socket.io";
import { MediasoupManager } from "../sfu/mediasoup";

interface PeerInfo {
  id: string;
  roomId: string;
  isStreamer: boolean;
}

export function setupSocketHandlers(
  io: SocketIOServer,
  mediasoupManager: MediasoupManager
) {
  const peers = new Map<string, PeerInfo>();

  io.on("connection", (socket) => {
    console.log(`New socket connection: ${socket.id}`);

    socket.on(
      "join-room",
      async (data: { roomId: string; isStreamer: boolean }, callback) => {
        try {
          const { roomId, isStreamer } = data;
          const room = await mediasoupManager.createRoom(roomId);
          mediasoupManager.addPeerToRoom(roomId, socket.id);

          peers.set(socket.id, { id: socket.id, roomId, isStreamer });
          socket.join(roomId);

          const rtpCapabilities = room.router.rtpCapabilities;
          socket
            .to(roomId)
            .emit("peer-joined", { peerId: socket.id, isStreamer });

          callback({ success: true, rtpCapabilities });
        } catch (error) {
          console.error("Error joining room:", error);
          callback({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    socket.on(
      "create-transport",
      async (data: { roomId: string; peerId: string }, callback) => {
        try {
          const { roomId, peerId } = data;
          const transportData = await mediasoupManager.createWebRtcTransport(
            roomId,
            peerId
          );
          callback({ success: true, ...transportData });
        } catch (error) {
          console.error("Error creating transport:", error);
          callback({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    socket.on(
      "connect-transport",
      async (
        data: { roomId: string; transportId: string; dtlsParameters: any },
        callback
      ) => {
        try {
          await mediasoupManager.connectTransport(
            data.roomId,
            data.transportId,
            data.dtlsParameters
          );
          callback({ success: true });
        } catch (error) {
          console.error("Error connecting transport:", error);
          callback({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    socket.on(
      "produce",
      async (
        data: {
          roomId: string;
          transportId: string;
          kind: "audio" | "video";
          rtpParameters: any;
        },
        callback
      ) => {
        try {
          const { roomId, transportId, kind, rtpParameters } = data;

          // This handles the race condition where a room might have been cleaned up.
          let room = mediasoupManager.getRoom(roomId);
          if (!room) {
            console.log(
              `Room ${roomId} not found during produce, creating it now.`
            );
            room = await mediasoupManager.createRoom(roomId);
            mediasoupManager.addPeerToRoom(roomId, socket.id);
          }

          const producer = await mediasoupManager.produce(
            roomId,
            socket.id,
            transportId,
            rtpParameters,
            kind
          );
          socket.to(roomId).emit("new-producer", {
            producerId: producer.id,
            peerId: socket.id,
          });
          callback({ success: true, producerId: producer.id });
        } catch (error) {
          console.error("Error creating producer:", error);
          callback({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    socket.on(
      "consume",
      async (
        data: {
          roomId: string;
          transportId: string;
          producerId: string;
          rtpCapabilities: any;
        },
        callback
      ) => {
        try {
          const consumerData = await mediasoupManager.consume(
            data.roomId,
            data.transportId,
            data.producerId,
            data.rtpCapabilities
          );
          callback({ success: true, ...consumerData });
        } catch (error) {
          console.error("Error creating consumer:", error);
          callback({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    socket.on(
      "resume-consumer",
      async (data: { roomId: string; consumerId: string }) => {
        try {
          await mediasoupManager.resumeConsumer(data.roomId, data.consumerId);
        } catch (error) {
          console.error("Error resuming consumer:", error);
        }
      }
    );

    // NEW: Get HLS URL handler
    socket.on("get-hls-url", (data: { roomId: string }, callback) => {
      try {
        const room = mediasoupManager.getRoom(data.roomId);
        if (room && room.hlsTranscoder && room.hlsTranscoder.isActive()) {
          const hlsUrl = room.hlsTranscoder.getPlaylistUrl();
          callback({ success: true, hlsUrl });
        } else {
          callback({
            success: false,
            error: "Stream not available. Waiting for streamers...",
          });
        }
      } catch (error) {
        console.error("Error getting HLS URL:", error);
        callback({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // NEW: Get room statistics handler
    socket.on("get-room-stats", (data: { roomId: string }, callback) => {
      try {
        const room = mediasoupManager.getRoom(data.roomId);
        if (room) {
          const stats = {
            roomId: data.roomId,
            peers: room.peers.size,
            transports: room.transports.size,
            producers: room.producers.size,
            consumers: room.consumers.size,
            hasHLS: room.hlsTranscoder ? room.hlsTranscoder.isActive() : false,
          };
          callback({ success: true, stats });
        } else {
          callback({
            success: false,
            error: "Room not found",
          });
        }
      } catch (error) {
        console.error("Error getting room stats:", error);
        callback({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
      const peer = peers.get(socket.id);
      if (peer) {
        mediasoupManager.removePeerFromRoom(peer.roomId, socket.id);
        socket.to(peer.roomId).emit("peer-left", { peerId: socket.id });
        peers.delete(socket.id);
      }
    });

    socket.on("error", (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });
}
