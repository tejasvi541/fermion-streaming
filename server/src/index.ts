import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

import { MediaSoupManager } from "./sfu/mediasoup";
import { setupSocketHandlers } from "./signaling/socket";

dotenv.config();
const app = express();

const server = createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.send("The world is burning but the CDN is still working");
});
