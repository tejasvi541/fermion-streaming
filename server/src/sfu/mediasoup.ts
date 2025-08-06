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
  private worker!: mediasoup.types.Worker;
  private rooms = new Map<string, Room>();

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
    },
  ];

  async initialize() {
    this.worker = await mediasoup.createWorker({ logLevel: "warn" });
    this.worker.on("died", () => {
      console.error("Mediasoup worker died, exiting...");
      process.exit(1);
    });
  }

  async createRoom(roomId: string): Promise<Room> {
    if (this.rooms.has(roomId)) return this.rooms.get(roomId)!;
    const router = await this.worker.createRouter({
      mediaCodecs: this.mediaCodecs,
    });
    const hlsTranscoder = new HLSTranscoder(roomId, router);
    const room: Room = {
      id: roomId,
      router,
      hlsTranscoder,
      peers: new Set(),
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom = (roomId: string) => this.rooms.get(roomId);

  async createWebRtcTransport(roomId: string, peerId: string) {
    const room = this.getRoom(roomId)!;
    const transport = await room.router.createWebRtcTransport({
      listenIps: [{ ip: "127.0.0.1" }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      appData: { peerId },
    });
    room.transports.set(transport.id, transport);
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(
    roomId: string,
    transportId: string,
    dtlsParameters: any
  ) {
    const transport = this.getRoom(roomId)?.transports.get(transportId);
    if (transport) await transport.connect({ dtlsParameters });
  }

  async produce(
    roomId: string,
    peerId: string,
    transportId: string,
    rtpParameters: any,
    kind: "audio" | "video"
  ) {
    const room = this.getRoom(roomId)!;
    const transport = room.transports.get(transportId)!;
    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData: { peerId },
    });
    room.producers.set(producer.id, producer);

    producer.on("transportclose", () => {
      producer.close();
      room.producers.delete(producer.id);
    });

    if (room.hlsTranscoder) {
      await room.hlsTranscoder.addProducer(peerId, producer);
    }
    return { id: producer.id };
  }

  async consume(
    roomId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: any
  ) {
    const room = this.getRoom(roomId)!;
    if (!room.router.canConsume({ producerId, rtpCapabilities }))
      throw new Error("Client cannot consume");

    const transport = room.transports.get(transportId)!;
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });
    room.consumers.set(consumer.id, consumer);
    consumer.on("transportclose", () => consumer.close());
    consumer.on("@producerclose", () => consumer.close());
    consumer.on("@close", () => room.consumers.delete(consumer.id));
    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  async resumeConsumer(roomId: string, consumerId: string) {
    await this.getRoom(roomId)?.consumers.get(consumerId)?.resume();
  }

  addPeerToRoom(roomId: string, peerId: string) {
    this.getRoom(roomId)?.peers.add(peerId);
  }

  removePeerFromRoom(roomId: string, peerId: string) {
    const room = this.getRoom(roomId);
    if (!room) return;

    room.peers.delete(peerId);
    console.log(`Peer ${peerId} removed from room ${roomId}`);

    // This is the critical fix: notify the transcoder
    if (room.hlsTranscoder) {
      room.hlsTranscoder.removePeer(peerId);
    }

    for (const transport of room.transports.values()) {
      if (transport.appData.peerId === peerId) transport.close();
    }

    if (room.peers.size === 0) this.cleanupRoom(roomId);
  }

  private cleanupRoom(roomId: string) {
    const room = this.getRoom(roomId);
    if (!room) return;
    console.log(`Cleaning up room ${roomId}`);
    room.hlsTranscoder?.stop();
    room.router.close();
    this.rooms.delete(roomId);
  }

  async close() {
    for (const roomId of this.rooms.keys()) await this.cleanupRoom(roomId);
    this.worker?.close();
  }
}
