import * as mediasoup from "mediasoup";
import {
  RtpCodecCapability,
  WebRtcTransport,
  Producer,
  Consumer,
  Router,
} from "mediasoup/node/lib/types";
import { HLSTranscoder } from "../hls/transcoder";

export interface Room {
  id: string;
  router: Router;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
  peers: Set<string>;
  hlsTranscoder: HLSTranscoder;
}

export class MediasoupManager {
  private worker: mediasoup.types.Worker | null = null;
  private rooms: Map<string, Room> = new Map();

  private readonly mediaCodecs: RtpCodecCapability[] = [
    {
      kind: "audio",
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
      preferredPayloadType: 111,
    },
    {
      kind: "video",
      mimeType: "video/VP8",
      clockRate: 90000,
      preferredPayloadType: 96,
      parameters: {
        "x-google-start-bitrate": 1000,
      },
    },
    {
      kind: "video",
      mimeType: "video/VP9",
      clockRate: 90000,
      preferredPayloadType: 97,
      parameters: {
        "profile-id": 2,
        "x-google-start-bitrate": 1000,
      },
    },
    {
      kind: "video",
      mimeType: "video/h264",
      clockRate: 90000,
      preferredPayloadType: 102,
      parameters: {
        "packetization-mode": 1,
        "profile-level-id": "4d0032",
        "level-asymmetry-allowed": 1,
        "x-google-start-bitrate": 1000,
      },
    },
  ];

  async initialize() {
    try {
      this.worker = await mediasoup.createWorker({
        logLevel: "warn",
        rtcMinPort: 20000,
        rtcMaxPort: 20100,
      });

      this.worker.on("died", (error) => {
        console.error("Mediasoup worker died:", error);
        setTimeout(() => process.exit(1), 2000);
      });

      console.log("Mediasoup worker created with PID:", this.worker.pid);
    } catch (error) {
      console.error("Failed to create mediasoup worker:", error);
      throw error;
    }
  }

  async createRoom(roomId: string): Promise<Room> {
    if (!this.worker) {
      throw new Error("Mediasoup worker not initialized");
    }
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId)!;
    }

    try {
      const router = await this.worker.createRouter({
        mediaCodecs: this.mediaCodecs,
      });

      const hlsTranscoder = new HLSTranscoder(roomId, router);

      const room: Room = {
        id: roomId,
        router,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        peers: new Set(),
        hlsTranscoder,
      };

      this.rooms.set(roomId, room);
      console.log(`Room created: ${roomId}`);

      return room;
    } catch (error) {
      console.error(`Failed to create room ${roomId}:`, error);
      throw error;
    }
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  async createWebRtcTransport(roomId: string) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    try {
      const webRtcTransportOptions = {
        listenIps: [
          {
            ip: "127.0.0.1",
            announcedIp: "127.0.0.1",
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      };

      const transport = await room.router.createWebRtcTransport(
        webRtcTransportOptions
      );

      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          console.log(`Transport closed: ${transport.id}`);
          transport.close();
          room.transports.delete(transport.id);
        }
      });

      // Store the transport in our map so we can find it later.
      room.transports.set(transport.id, transport);

      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    } catch (error) {
      console.error("Failed to create WebRTC transport:", error);
      throw error;
    }
  }

  async connectTransport(
    roomId: string,
    transportId: string,
    dtlsParameters: any
  ) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const transport = room.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found in room ${roomId}`);
    }

    try {
      await transport.connect({ dtlsParameters });
      console.log(`Transport connected: ${transportId}`);
    } catch (error) {
      console.error(`Failed to connect transport ${transportId}:`, error);
      throw error;
    }
  }

  async produce(
    roomId: string,
    peerId: string,
    transportId: string,
    rtpParameters: any,
    kind: "audio" | "video"
  ) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const transport = room.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }

    try {
      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: { peerId }, // Associate producer with peerId
      });

      producer.on("transportclose", () => {
        console.log(`Producer's transport closed: ${producer.id}`);
        producer.close();
        room.producers.delete(producer.id);
      });

      room.producers.set(producer.id, producer);
      console.log(
        `Producer created: ${producer.id} (${kind}) for peer ${peerId}`
      );

      await room.hlsTranscoder.addProducer(peerId, producer);

      return { id: producer.id };
    } catch (error) {
      console.error(`Failed to create producer for peer ${peerId}:`, error);
      throw error;
    }
  }

  async consume(
    roomId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: any
  ) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const transport = room.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }

    const producer = room.producers.get(producerId);
    if (!producer) {
      throw new Error(`Producer ${producerId} not found`);
    }

    try {
      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        throw new Error("Client cannot consume this producer");
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      consumer.on("transportclose", () => {
        console.log(`Consumer's transport closed: ${consumer.id}`);
      });

      consumer.on("producerclose", () => {
        console.log(`Consumer's producer closed: ${consumer.id}`);
      });

      room.consumers.set(consumer.id, consumer);
      console.log(`Consumer created: ${consumer.id}`);

      return {
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      };
    } catch (error) {
      console.error("Failed to create consumer:", error);
      throw error;
    }
  }

  async resumeConsumer(roomId: string, consumerId: string) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const consumer = room.consumers.get(consumerId);
    if (!consumer) {
      throw new Error(`Consumer ${consumerId} not found`);
    }

    await consumer.resume();
    console.log(`Consumer resumed: ${consumerId}`);
  }

  addPeerToRoom(roomId: string, peerId: string) {
    const room = this.getRoom(roomId);
    if (room) {
      room.peers.add(peerId);
      console.log(`Peer ${peerId} added to room ${roomId}`);
    }
  }

  removePeerFromRoom(roomId: string, peerId: string) {
    const room = this.getRoom(roomId);
    if (!room) return;

    room.peers.delete(peerId);
    console.log(`Peer ${peerId} removed from room ${roomId}`);

    for (const producer of room.producers.values()) {
      if (producer.appData.peerId === peerId) {
        producer.close();
        room.producers.delete(producer.id);
      }
    }

    if (room.peers.size === 0) {
      console.log(`Room ${roomId} is empty, cleaning up.`);
      this.cleanupRoom(roomId);
    } else {
      if (room.hlsTranscoder && room.hlsTranscoder.isActive()) {
        console.log(`A streamer left, stopping HLS for room ${roomId}.`);
        room.hlsTranscoder.stop();
      }
    }
  }

  private async cleanupRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    console.log(`Cleaning up room ${roomId}`);

    if (room.hlsTranscoder) {
      room.hlsTranscoder.stop();
    }

    room.router.close();
    this.rooms.delete(roomId);
    console.log(`Room ${roomId} cleaned up`);
  }

  getRoomStats(roomId: string) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    return {
      roomId,
      peers: room.peers.size,
      transports: room.transports.size,
      producers: room.producers.size,
      consumers: room.consumers.size,
      hasHLS: room.hlsTranscoder?.isActive() ?? false,
    };
  }

  async close() {
    console.log("Closing MediasoupManager...");

    for (const roomId of this.rooms.keys()) {
      await this.cleanupRoom(roomId);
    }

    if (this.worker) {
      this.worker.close();
    }
  }
}
