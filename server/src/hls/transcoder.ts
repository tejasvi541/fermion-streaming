import * as mediasoup from "mediasoup";
import { Router } from "mediasoup/node/lib/types";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Interface to hold RTP port information for a single media stream (audio or video)
interface RtpInfo {
  port: number;
  ssrc: number;
  payloadType: number;
}

// Interface to hold all necessary info for a single streamer
interface StreamerInfo {
  video?: { producerId: string; rtpInfo: RtpInfo };
  audio?: { producerId: string; rtpInfo: RtpInfo };
}

export class HLSTranscoder {
  private roomId: string;
  private router: Router;
  private ffmpegProcess?: ChildProcess;
  private isTranscoding: boolean = false;
  private hlsPath: string;
  private sdpFilePath: string;

  // Use a Map to store information about each streamer, keyed by a unique ID (e.g., peerId)
  private streamers = new Map<string, StreamerInfo>();

  constructor(roomId: string, router: Router) {
    this.roomId = roomId;
    this.router = router;
    this.hlsPath = path.join(__dirname, "../../static/hls", roomId);
    this.sdpFilePath = path.join(this.hlsPath, "stream.sdp");

    // Create the directory for HLS files if it doesn't exist
    if (!fs.existsSync(this.hlsPath)) {
      fs.mkdirSync(this.hlsPath, { recursive: true });
    }
  }

  /**
   * Adds a producer from a peer. This is the main entry point for starting the stream.
   * It collects producers and starts transcoding once enough participants have joined.
   * @param peerId - A unique identifier for the peer/streamer.
   * @param producer - The mediasoup producer object.
   */
  async addProducer(peerId: string, producer: mediasoup.types.Producer) {
    console.log(
      `Adding producer ${producer.id} of kind ${producer.kind} from peer ${peerId}`
    );

    // Get or create the streamer info object for this peer
    if (!this.streamers.has(peerId)) {
      this.streamers.set(peerId, {});
    }
    const streamerInfo = this.streamers.get(peerId)!;

    // Create a PlainTransport to get the RTP stream for this producer
    const transport = await this.router.createPlainTransport({
      listenIp: { ip: "127.0.0.1", announcedIp: "127.0.0.1" },
      rtcpMux: true,
      comedia: false,
    });

    // Create a consumer to receive the media from the producer
    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: this.router.rtpCapabilities, // Ensure consumer can handle the media
      paused: true, // Start paused until we're ready
    });

    const rtpInfo: RtpInfo = {
      port: transport.tuple.localPort,
      ssrc: consumer.rtpParameters.encodings![0].ssrc!,
      payloadType: consumer.rtpParameters.codecs[0].payloadType,
    };

    // Store the RTP info based on whether it's audio or video
    if (producer.kind === "video") {
      streamerInfo.video = { producerId: producer.id, rtpInfo };
    } else if (producer.kind === "audio") {
      streamerInfo.audio = { producerId: producer.id, rtpInfo };
    }

    // IMPORTANT: Resume the consumer so media starts flowing to the transport
    await consumer.resume();

    this.checkAndStartTranscoding();
  }

  /**
   * Checks if we have enough participants to start the mixed HLS stream.
   * For this assignment, it waits for exactly two participants with both audio and video.
   */
  private checkAndStartTranscoding() {
    if (this.isTranscoding) {
      return; // Already running
    }

    const readyStreamers = Array.from(this.streamers.values()).filter(
      (s) => s.audio && s.video
    );

    if (readyStreamers.length === 2) {
      console.log("Two participants ready. Starting FFMPEG mixer...");
      this.start(readyStreamers);
    } else {
      console.log(
        `Waiting for more participants. Have ${readyStreamers.length}/2.`
      );
    }
  }

  /**
   * Starts the FFMPEG process with the collected streamer info.
   * @param readyStreamers - An array of two fully ready streamer info objects.
   */
  private async start(readyStreamers: StreamerInfo[]) {
    this.isTranscoding = true;
    try {
      const sdpContent = this.createSdpFile(readyStreamers);
      fs.writeFileSync(this.sdpFilePath, sdpContent);
      console.log(`SDP file created at ${this.sdpFilePath}`);

      await this.startFFMPEG();
      console.log(`FFMPEG mixer started for room ${this.roomId}`);
    } catch (error) {
      console.error(
        `Error starting transcoding for room ${this.roomId}:`,
        error
      );
      this.isTranscoding = false;
    }
  }

  /**
   * Generates the content for the SDP file based on the streamers' RTP info.
   * This file tells FFMPEG where to listen for each audio and video stream.
   */
  private createSdpFile(streamers: StreamerInfo[]): string {
    // Note: Codec details (e.g., VP8, opus) should match what clients are sending.
    // This is a simplified example.
    return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFMPEG
c=IN IP4 127.0.0.1
t=0 0
m=video ${streamers[0].video!.rtpInfo.port} RTP/AVP ${
      streamers[0].video!.rtpInfo.payloadType
    }
a=rtpmap:${streamers[0].video!.rtpInfo.payloadType} VP8/90000
m=audio ${streamers[0].audio!.rtpInfo.port} RTP/AVP ${
      streamers[0].audio!.rtpInfo.payloadType
    }
a=rtpmap:${streamers[0].audio!.rtpInfo.payloadType} opus/48000/2
m=video ${streamers[1].video!.rtpInfo.port} RTP/AVP ${
      streamers[1].video!.rtpInfo.payloadType
    }
a=rtpmap:${streamers[1].video!.rtpInfo.payloadType} VP8/90000
m=audio ${streamers[1].audio!.rtpInfo.port} RTP/AVP ${
      streamers[1].audio!.rtpInfo.payloadType
    }
a=rtpmap:${streamers[1].audio!.rtpInfo.payloadType} opus/48000/2
`;
  }

  /**
   * Constructs the FFMPEG command with a complex filter to mix the streams
   * and starts the child process.
   */
  private async startFFMPEG() {
    const playlistPath = path.join(this.hlsPath, "playlist.m3u8");
    const segmentPath = path.join(this.hlsPath, "segment_%03d.ts");

    // This is the core of the mixing logic.
    const filterComplex =
      // Scale both video inputs to be half the width of the final output.
      "[0:v]scale=640:720[left];" +
      "[2:v]scale=640:720[right];" +
      // Place them side-by-side.
      "[left][right]hstack=inputs=2[v];" +
      // Mix both audio inputs into a single stereo track.
      "[1:a][3:a]amix=inputs=2:duration=first:dropout_transition=3[a]";

    const ffmpegArgs = [
      // Whitelist protocols since we're using a file-based SDP input.
      "-protocol_whitelist",
      "file,udp,rtp",
      "-i",
      this.sdpFilePath, // Use the SDP file as the single input.
      "-filter_complex",
      filterComplex,
      "-map",
      "[v]", // Map the final video stream from the filter.
      "-map",
      "[a]", // Map the final audio stream from the filter.

      // Standard video encoding settings
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-s",
      "1280x720", // Final output resolution
      "-r",
      "30",
      "-b:v",
      "2500k",
      "-maxrate",
      "2500k",
      "-bufsize",
      "5000k",

      // Standard audio encoding settings
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "44100",

      // HLS output settings
      "-f",
      "hls",
      "-hls_time",
      "2",
      "-hls_list_size",
      "10",
      "-hls_flags",
      "delete_segments+independent_segments",
      "-hls_segment_type",
      "mpegts",
      "-hls_segment_filename",
      segmentPath,
      "-y",
      playlistPath,
    ];

    console.log("Starting FFMPEG with args:", ffmpegArgs.join(" "));
    this.ffmpegProcess = spawn("ffmpeg", ffmpegArgs);

    // Add logging and error handling for the FFMPEG process
    this.ffmpegProcess.stderr?.on("data", (data) => {
      // FFMPEG logs progress to stderr, so we log it for debugging.
      console.log(`FFMPEG: ${data.toString().trim()}`);
    });

    this.ffmpegProcess.on("close", (code) => {
      console.log(`FFMPEG process exited with code ${code}`);
      this.stop(); // Ensure cleanup happens if FFMPEG stops unexpectedly.
    });
  }

  /**
   * Stops the FFMPEG process and cleans up all generated files.
   */
  public stop() {
    if (!this.isTranscoding) {
      return;
    }
    console.log(`Stopping HLS transcoding for room ${this.roomId}`);
    this.isTranscoding = false;

    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill("SIGTERM");
      this.ffmpegProcess = undefined;
    }

    this.cleanupFiles();
  }

  private cleanupFiles() {
    console.log(`Cleaning up HLS and SDP files for room ${this.roomId}`);
    try {
      if (fs.existsSync(this.hlsPath)) {
        // Delete all .ts segments, the .m3u8 playlist, and the .sdp file
        fs.readdirSync(this.hlsPath).forEach((file) => {
          fs.unlinkSync(path.join(this.hlsPath, file));
        });
        fs.rmdirSync(this.hlsPath);
      }
    } catch (error) {
      console.error(`Failed to cleanup files for room ${this.roomId}:`, error);
    }
  }

  public getPlaylistUrl(): string {
    return `/hls/${this.roomId}/playlist.m3u8`;
  }

  public isActive(): boolean {
    return this.isTranscoding;
  }
}
