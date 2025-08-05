# Fermion Streaming Assignment

A full-stack WebRTC streaming application with HLS playback, built as part of the Fermion engineering assignment.

## Overview

This application implements a dual-streaming architecture where users can either participate in a WebRTC call or watch it as a live HLS stream. It demonstrates real-time communication capabilities alongside traditional streaming infrastructure.

### User Flows

1. **Stream Participants** (`/stream`): Users can join a WebRTC call with camera/microphone
2. **Stream Viewers** (`/watch`): Users can watch the ongoing call as a live HLS stream

## Architecture

### Frontend

- **Next.js 14** with TypeScript
- WebRTC peer connections for real-time communication
- HLS.js for video playback
- Real-time signaling via WebSocket

### Backend

- **Node.js/TypeScript** server
- **Mediasoup** SFU for WebRTC media routing
- **FFmpeg** for HLS transcoding and segmentation
- WebSocket signaling server
- Static file serving for HLS segments

### Key Components

```
├── frontend/           # Next.js application
│   ├── src/app/
│   │   ├── stream/     # WebRTC streaming page
│   │   └── watch/      # HLS playback page
├── server/             # Node.js backend
│   ├── src/
│   │   ├── sfu/        # Mediasoup SFU implementation
│   │   ├── signaling/  # WebSocket signaling
│   │   └── hls/        # HLS transcoding pipeline
│   └── static/hls/     # HLS segments storage
```

## Technical Implementation

### WebRTC Flow

1. Users connect to signaling server via WebSocket
2. SFU creates router and transport for each participant
3. Media streams are routed through Mediasoup
4. Peer connections established for real-time communication

### HLS Pipeline

1. Mediasoup streams are consumed by FFmpeg process
2. FFmpeg transcodes to HLS format with configurable segments
3. Segments are stored in static directory
4. Frontend fetches and plays segments via HLS.js

### Real-time Synchronization

- WebSocket events for participant join/leave
- SFU handles media routing and quality adaptation (P.S there are many algorithm u can fine tune like ABR, DASH, which i implemented in my master's as well)
- HLS provides ~2-3 second latency for viewers

## Local Development

### Prerequisites

- Node.js 18+
- FFmpeg installed and available in PATH

### Setup

```bash
# Install dependencies
npm install

# Start backend server
cd server
npm run dev

# Start frontend (in new terminal)
cd frontend
npm run dev
```

### URLs

- Stream page: http://localhost:3000/stream
- Watch page: http://localhost:3000/watch
- Backend: http://localhost:8000

## Configuration

Key environment variables:

```bash
# Server
PORT=3001
HLS_SEGMENT_DURATION=4
HLS_SEGMENT_COUNT=3

# Frontend
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NEXT_PUBLIC_HLS_URL=http://localhost:8000/hls/stream.m3u8
```

## Technology Choices

### Why Mediasoup?

- Production-ready SFU with excellent TypeScript support
- Handles complex media routing scenarios
- Great documentation and active community
- Used by major video platforms

### Why FFmpeg for HLS?

- Industry standard for video transcoding
- Reliable HLS segmentation
- Configurable quality and latency settings
- Broad codec support

### Why Next.js?

- Server-side rendering capabilities
- Built-in routing and optimization
- Great TypeScript integration
- Matches Fermion's tech stack

## Performance Considerations

- SFU architecture scales better than mesh networks
- HLS segments cached for efficient delivery
- WebRTC adaptive bitrate based on network conditions
- Configurable quality settings for different devices

## Potential Improvements

### For Production

- Redis for signaling state management
- CDN for HLS segment delivery
- Database for session persistence
- Load balancing for multiple SFU instances
- Enhanced error handling and reconnection logic

### Features

- Recording capabilities
- Chat integration
- Screen sharing support
- Multiple room support
- User authentication

## Demo

The application demonstrates:

1. Multiple users joining WebRTC call simultaneously
2. Real-time video/audio communication
3. Live HLS stream generation from ongoing call
4. Seamless viewer experience with minimal latency

---

Built with passion for real-time communication technology. The architecture showcases understanding of both WebRTC complexities and streaming infrastructure requirements.
