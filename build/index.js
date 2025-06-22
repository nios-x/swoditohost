import { randomUUID } from "crypto";
import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

// Support __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Game state
const players = new Map();
const room = new Map();

// Serve static files from /dist
const httpServer = http.createServer((req, res) => {
  const reqUrl = req.url === "/" ? "/index.html" : req.url || "/";
  const filePath = path.join(__dirname, "dist", reqUrl);
  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };

  fs.readFile(filePath, (err, data) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (err) {
      // Fallback to index.html for SPA routes
      fs.readFile(path.join(__dirname, "dist", "index.html"), (fallbackErr, fallbackData) => {
        if (fallbackErr) {
          res.writeHead(500);
          return res.end("Internal Server Error");
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(fallbackData);
      });
    } else {
      res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
      res.end(data);
    }
  });
});

// WebSocket setup
const ws = new WebSocketServer({ server: httpServer });
ws.on("connection", (_socket) => {
  const id = randomUUID();
  const socket = _socket;
  socket.id = id;

  players.set(id, {
    socket,
    coordinates: { x: 500, y: 500, z: 0 },
    direction: 0,
    room: null,
    isReady: false,
    isRunning: false,
  });

  socket.on("message", (res) => {
    const data = JSON.parse(res.toString());
    const player = players.get(socket.id);
    if (!player) return;

    if (data.pos) {
      player.coordinates = { x: data.pos.x, y: data.pos.y, z: data.pos.z };
      player.direction = data.pos.direction;
      player.isRunning = data.pos.isRunning;
    } else if (typeof data.room === "string" && data.name) {
      player.name = data.name;

      if (room.has(data.room)) {
        const members = room.get(data.room);
        if (!members.has(socket.id)) {
          members.add(socket.id);
          player.room = data.room;
          player.isReady = true;
          socket.send(JSON.stringify({ roomid: data.room, id: socket.id }));
        }
      } else {
        const roomid = Date.now().toString().substring(4, 10);
        room.set(roomid, new Set([socket.id]));
        player.room = roomid;
        player.isReady = true;
        socket.send(JSON.stringify({ roomid, id: socket.id }));
      }
    }
  });

  socket.on("close", () => {
    players.delete(socket.id);
    for (const [roomid, members] of room.entries()) {
      members.delete(socket.id);
      if (members.size === 0) room.delete(roomid);
    }
  });
});

// Broadcast other players (60 FPS)
setInterval(() => {
  for (const [id, player] of players.entries()) {
    if (!player.isReady || !player.room) continue;

    const members = room.get(player.room);
    if (!members) continue;

    const others = Array.from(members)
      .filter((otherId) => otherId !== id)
      .map((otherId) => {
        const other = players.get(otherId);
        if (!other) return null;
        return {
          id: other.socket.id,
          name: other.name,
          x: other.coordinates.x,
          y: other.coordinates.y,
          z: other.coordinates.z,
          dir: other.direction,
          isRunning: other.isRunning,
        };
      })
      .filter(Boolean);

    try {
      player.socket.send(JSON.stringify({ type: "others", players: others }));
    } catch (err) {
      console.error(`Failed to send to player ${id}`, err);
    }
  }
}, 1000 / 60);

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🟢 Server listening at http://localhost:${PORT}`);
});
