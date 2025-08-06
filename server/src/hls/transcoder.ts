import * as mediasoup from "mediasoup";
import { Router } from "mediasoup/node/lib/types";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface RtpInfo {
  port: number;
}

interface StreamerInfo {
  video?: { producerId: string; rtpInfo: RtpInfo };
  audio?: { producerId: string; rtpInfo: RtpInfo };
  transports: Set<mediasoup.types.PlainTransport>;
}

export class HLSTranscoder {
  private roomId: string;
  private router: Router;
  private ffmpegProcess?: ChildProcess;
  private isTranscoding: boolean = false;
  private hlsPath: string;
  private sdpFilePath: string;
  private streamers = new Map<string, StreamerInfo>();

  constructor(roomId: string, router: Router) {
    this.roomId = roomId;
    this.router = router;
    this.hlsPath = path.join(__dirname, "../../static/hls", roomId);
    this.sdpFilePath = path.join(this.hlsPath, "stream.sdp");
    this.ensureHlsDir();
  }

  private ensureHlsDir() {
    if (!fs.existsSync(this.hlsPath)) {
      fs.mkdirSync(this.hlsPath, { recursive: true });
    }
  }

  async addProducer(peerId: string, producer: mediasoup.types.Producer) {
    console.log(`Adding producer for peer ${peerId}, kind: ${producer.kind}`);

    if (!this.streamers.has(peerId)) {
      this.streamers.set(peerId, { transports: new Set() });
    }
    const streamerInfo = this.streamers.get(peerId)!;

    try {
      const transport = await this.router.createPlainTransport({
        listenIp: { ip: "127.0.0.1", announcedIp: undefined },
        rtcpMux: false,
        comedia: true,
      });
      streamerInfo.transports.add(transport);

      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: this.router.rtpCapabilities,
        paused: true,
      });

      const rtpInfo: RtpInfo = { port: transport.tuple.localPort };

      if (producer.kind === "video") {
        streamerInfo.video = { producerId: producer.id, rtpInfo };
      } else if (producer.kind === "audio") {
        streamerInfo.audio = { producerId: producer.id, rtpInfo };
      }

      await consumer.resume();

      console.log(
        `Producer added for ${peerId}, checking transcoding conditions...`
      );
      this.checkAndStartTranscoding();
    } catch (error) {
      console.error(`Failed to add producer for ${peerId}:`, error);
    }
  }

  public removePeer(peerId: string) {
    console.log(`Removing peer ${peerId} from HLS transcoder`);
    const streamerInfo = this.streamers.get(peerId);
    if (streamerInfo) {
      streamerInfo.transports.forEach((transport) => {
        try {
          transport.close();
        } catch (error) {
          console.error(`Error closing transport for ${peerId}:`, error);
        }
      });
    }
    this.streamers.delete(peerId);

    // Stop transcoding if we no longer have enough participants
    if (this.isTranscoding) {
      console.log(
        `Peer ${peerId} left, stopping HLS transcoding for room ${this.roomId}`
      );
      this.stop();
    }
  }

  private checkAndStartTranscoding() {
    if (this.isTranscoding) {
      console.log("Transcoding already active");
      return;
    }

    const readyStreamers = Array.from(this.streamers.values()).filter(
      (s) => s.audio && s.video
    );

    console.log(`Ready streamers: ${readyStreamers.length}/2 required`);

    if (readyStreamers.length >= 2) {
      console.log(
        "Two or more participants ready. Starting FFMPEG transcoder..."
      );
      this.start(readyStreamers.slice(0, 2)); // Use first 2 streamers
    } else {
      console.log(
        `Waiting for more participants. Have ${readyStreamers.length}/2.`
      );
    }
  }

  private start(readyStreamers: StreamerInfo[]) {
    if (this.isTranscoding) return;

    this.isTranscoding = true;
    this.ensureHlsDir();

    try {
      const sdpContent = this.createSdpFile(readyStreamers);
      fs.writeFileSync(this.sdpFilePath, sdpContent);
      console.log("SDP file created:", this.sdpFilePath);

      this.startFFMPEG();
    } catch (error) {
      console.error("Failed to start transcoding:", error);
      this.isTranscoding = false;
    }
  }

  private createSdpFile(streamers: StreamerInfo[]): string {
    console.log("Creating SDP file for", streamers.length, "streamers");

    const sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=Stream
c=IN IP4 127.0.0.1
t=0 0
m=video ${streamers[0].video!.rtpInfo.port} RTP/AVP 96
a=rtpmap:96 VP8/90000
a=sendonly
m=audio ${streamers[0].audio!.rtpInfo.port} RTP/AVP 111
a=rtpmap:111 opus/48000/2
a=sendonly
m=video ${streamers[1].video!.rtpInfo.port} RTP/AVP 96
a=rtpmap:96 VP8/90000
a=sendonly
m=audio ${streamers[1].audio!.rtpInfo.port} RTP/AVP 111
a=rtpmap:111 opus/48000/2
a=sendonly
`;

    console.log("Generated SDP:", sdp);
    return sdp;
  }

  private startFFMPEG() {
    const playlistPath = path.join(this.hlsPath, "playlist.m3u8");
    const segmentPath = path.join(this.hlsPath, "segment_%03d.ts");

    // Side-by-side layout with audio mixing
    const filterComplex = [
      "[0:v]scale=960:540,setpts=PTS-STARTPTS[v0]",
      "[2:v]scale=960:540,setpts=PTS-STARTPTS[v1]",
      "[v0][v1]hstack=inputs=2[video]",
      "[1:a][3:a]amix=inputs=2:duration=first:dropout_transition=0[audio]",
    ].join(";");

    const args = [
      "-re", // Read input at native frame rate
      "-protocol_whitelist",
      "file,udp,rtp",
      "-i",
      this.sdpFilePath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[video]",
      "-map",
      "[audio]",

      // Video encoding
      "-c:v",
      "libx264",
      "-preset",
      "faster",
      "-tune",
      "zerolatency",
      "-profile:v",
      "baseline",
      "-level",
      "3.1",
      "-crf",
      "28",
      "-maxrate",
      "2500k",
      "-bufsize",
      "5000k",
      "-g",
      "60", // GOP size
      "-keyint_min",
      "60",
      "-s",
      "1920x540",
      "-r",
      "30",

      // Audio encoding
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",

      // HLS settings
      "-f",
      "hls",
      "-hls_time",
      "4", // 4 second segments
      "-hls_list_size",
      "6", // Keep 6 segments (24 seconds)
      "-hls_flags",
      "delete_segments+append_list+omit_endlist",
      "-hls_segment_type",
      "mpegts",
      "-hls_segment_filename",
      segmentPath,
      "-hls_allow_cache",
      "0",

      // Output
      playlistPath,
    ];

    console.log("Starting FFMPEG with command:");
    console.log("ffmpeg", args.join(" "));

    this.ffmpegProcess = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.ffmpegProcess.stdout?.on("data", (data) => {
      console.log(`FFMPEG stdout: ${data}`);
    });

    this.ffmpegProcess.stderr?.on("data", (data) => {
      const output = data.toString();
      // Only log important messages, not every frame
      if (
        output.includes("error") ||
        output.includes("warning") ||
        output.includes("Starting")
      ) {
        console.log(`FFMPEG: ${output}`);
      }
    });

    this.ffmpegProcess.on("close", (code) => {
      console.log(`FFMPEG process exited with code ${code}`);
      this.stop();
    });

    this.ffmpegProcess.on("error", (error) => {
      console.error("FFMPEG process error:", error);
      this.stop();
    });

    console.log(`HLS transcoding started for room ${this.roomId}`);
  }

  public stop() {
    if (!this.isTranscoding) return;

    console.log(`Stopping HLS transcoding for room ${this.roomId}`);
    this.isTranscoding = false;

    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.kill("SIGTERM");

        // Force kill if it doesn't stop within 5 seconds
        setTimeout(() => {
          if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
            console.log("Force killing FFMPEG process");
            this.ffmpegProcess.kill("SIGKILL");
          }
        }, 5000);
      } catch (error) {
        console.error("Error stopping FFMPEG:", error);
      }
      this.ffmpegProcess = undefined;
    }

    // Clean up files after a short delay to allow viewers to finish
    setTimeout(() => {
      this.cleanupFiles();
    }, 10000);
  }

  private cleanupFiles() {
    console.log(`Cleaning up HLS files for room ${this.roomId}`);

    if (fs.existsSync(this.hlsPath)) {
      try {
        const files = fs.readdirSync(this.hlsPath);
        for (const file of files) {
          const filePath = path.join(this.hlsPath, file);
          fs.unlinkSync(filePath);
        }
        console.log(`Cleaned up ${files.length} HLS files`);
      } catch (error) {
        console.error("Error cleaning up HLS files:", error);
      }
    }
  }

  public getPlaylistUrl = () => `/hls/${this.roomId}/playlist.m3u8`;
  public isActive = () => this.isTranscoding;
}
