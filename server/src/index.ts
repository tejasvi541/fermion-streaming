import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import { MediasoupManager } from "./sfu/mediasoup";
import { setupSocketHandlers } from "./signaling/socket";

dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "http://localhost:3001",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve HLS static files
app.use("/hls", express.static(path.join(__dirname, "../static/hls")));

// Initialize mediasoup
const mediasoupManager = new MediasoupManager();

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Setup Socket.IO handlers
setupSocketHandlers(io, mediasoupManager);

// Start server
async function startServer() {
  try {
    await mediasoupManager.initialize();
    console.log("Mediasoup initialized successfully");

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`HLS endpoint: http://localhost:${PORT}/hls`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down server...");
  await mediasoupManager.close();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
