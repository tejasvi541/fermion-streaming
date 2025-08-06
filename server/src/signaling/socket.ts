import { Server as SocketIOServer, Socket } from "socket.io";
import { MediasoupManager } from "../sfu/mediasoup";

// This interface helps track which socket belongs to which room and its role.
interface PeerInfo {
  id: string;
  roomId: string;
  isStreamer: boolean;
}

interface JoinRoomData {
  roomId: string;
  isStreamer: boolean;
}

export function setupSocketHandlers(
  io: SocketIOServer,
  mediasoupManager: MediasoupManager
) {
  // A map to keep track of our connected peers and their info.
  const peers = new Map<string, PeerInfo>();

  io.on("connection", (socket) => {
    console.log(`New socket connection: ${socket.id}`);

    // --- Join Room ---
    socket.on("join-room", async (data: JoinRoomData, callback) => {
      try {
        const { roomId, isStreamer } = data;
        console.log(
          `${socket.id} joining room ${roomId} as ${
            isStreamer ? "streamer" : "viewer"
          }`
        );

        const room = await mediasoupManager.createRoom(roomId);
        mediasoupManager.addPeerToRoom(roomId, socket.id);

        peers.set(socket.id, { id: socket.id, roomId, isStreamer });
        socket.join(roomId);

        const rtpCapabilities = room.router.rtpCapabilities;

        // Notify other peers that a new peer has joined.
        socket
          .to(roomId)
          .emit("peer-joined", { peerId: socket.id, isStreamer });

        callback({
          success: true,
          rtpCapabilities,
          roomStats: mediasoupManager.getRoomStats(roomId),
        });
        console.log(`${socket.id} joined room ${roomId}`);
      } catch (error) {
        console.error("Error joining room:", error);
        callback({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // --- Create WebRTC Transport ---
    socket.on(
      "create-transport",
      async (data: { roomId: string }, callback) => {
        try {
          const { roomId } = data;
          console.log(`Creating transport for ${socket.id} in room ${roomId}`);

          // The manager no longer needs the peerId at this stage.
          const transportData = await mediasoupManager.createWebRtcTransport(
            roomId
          );

          callback({ success: true, ...transportData });
          console.log(`Transport created: ${transportData.id}`);
        } catch (error) {
          console.error("Error creating transport:", error);
          callback({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    // --- Connect Transport ---
    socket.on(
      "connect-transport",
      async (
        data: { roomId: string; transportId: string; dtlsParameters: any },
        callback
      ) => {
        try {
          const { roomId, transportId, dtlsParameters } = data;
          console.log(`Connecting transport ${transportId} for ${socket.id}`);

          await mediasoupManager.connectTransport(
            roomId,
            transportId,
            dtlsParameters
          );

          callback({ success: true });
          console.log(`Transport connected: ${transportId}`);
        } catch (error) {
          console.error("Error connecting transport:", error);
          callback({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    // --- Produce Media ---
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
          console.log(`Creating producer for ${socket.id} - ${kind}`);

          // Pass the socket.id as the peerId to the manager.
          // This is the key change to link the producer to the peer.
          const { id: producerId } = await mediasoupManager.produce(
            roomId,
            socket.id, // peerId
            transportId,
            rtpParameters,
            kind
          );

          // Notify other peers that a new stream is available to be consumed.
          socket.to(roomId).emit("new-producer", {
            producerId,
            peerId: socket.id,
            kind,
          });

          callback({ success: true, producerId });
          console.log(`Producer created: ${producerId} (${kind})`);
        } catch (error) {
          console.error("Error creating producer:", error);
          callback({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    // --- Consume Media ---
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
          const { roomId, transportId, producerId, rtpCapabilities } = data;
          console.log(
            `Creating consumer for ${socket.id} - producer: ${producerId}`
          );

          const consumerData = await mediasoupManager.consume(
            roomId,
            transportId,
            producerId,
            rtpCapabilities
          );

          callback({ success: true, ...consumerData });
          console.log(`Consumer created: ${consumerData.id}`);
        } catch (error) {
          console.error("Error creating consumer:", error);
          callback({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    // --- Resume Consumer ---
    socket.on(
      "resume-consumer",
      async (data: { roomId: string; consumerId: string }, callback) => {
        try {
          const { roomId, consumerId } = data;
          console.log(`Resuming consumer ${consumerId} for ${socket.id}`);

          await mediasoupManager.resumeConsumer(roomId, consumerId);

          callback({ success: true });
          console.log(`Consumer resumed: ${consumerId}`);
        } catch (error) {
          console.error("Error resuming consumer:", error);
          callback({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    // --- Get HLS Playlist URL ---
    socket.on("get-hls-url", (data: { roomId: string }, callback) => {
      try {
        const { roomId } = data;
        const room = mediasoupManager.getRoom(roomId);

        if (room && room.hlsTranscoder && room.hlsTranscoder.isActive()) {
          callback({
            success: true,
            hlsUrl: room.hlsTranscoder.getPlaylistUrl(),
          });
        } else {
          callback({
            success: false,
            error: "HLS stream not available",
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

    // --- Get Room Stats ---
    socket.on("get-room-stats", (data: { roomId: string }, callback) => {
      try {
        const { roomId } = data;
        const stats = mediasoupManager.getRoomStats(roomId);

        callback({ success: true, stats });
      } catch (error) {
        console.error("Error getting room stats:", error);
        callback({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // --- Handle Disconnect ---
    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);

      const peer = peers.get(socket.id);
      if (peer) {
        mediasoupManager.removePeerFromRoom(peer.roomId, socket.id);

        socket.to(peer.roomId).emit("peer-left", { peerId: socket.id });

        peers.delete(socket.id);
        console.log(`Peer ${socket.id} left room ${peer.roomId}`);
      }
    });

    socket.on("error", (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });

  console.log("Socket.IO handlers initialized");
}
