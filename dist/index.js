import express from "express";
import path from "path";
import fs from "fs";
import http from "http";
import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";
// Setup Express and HTTP Server
const app = express();
const server = http.createServer(app);
// Serve frontend files from dist folder
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));
app.get("*", (req, res) => {
    const indexPath = path.join(distPath, "index.html");
    fs.readFile(indexPath, (err, data) => {
        if (err)
            return res.status(500).send("Internal Server Error");
        res.setHeader("Content-Type", "text/html");
        res.send(data);
    });
});
// Game state
const players = new Map();
const room = new Map();
// Setup WebSocket Server
const wss = new WebSocketServer({ server });
wss.on("connection", (socket) => {
    const id = randomUUID();
    socket.id = id;
    players.set(id, {
        socket: socket,
        coordinates: { x: 500, y: 500, z: 0 },
        direction: 0,
        room: null,
        isReady: false,
        isRunning: false,
    });
    socket.on("message", (msg) => {
        const data = JSON.parse(msg.toString());
        const player = players.get(socket.id);
        if (!player)
            return;
        if (data.pos) {
            player.coordinates = { x: data.pos.x, y: data.pos.y, z: data.pos.z };
            player.direction = data.pos.direction;
            player.isRunning = data.pos.isRunning;
        }
        else if (typeof data.room === "string" && data.name) {
            player.name = data.name;
            if (room.has(data.room)) {
                const members = room.get(data.room);
                if (!members.has(socket.id)) {
                    members.add(socket.id);
                    player.room = data.room;
                    player.isReady = true;
                    socket.send(JSON.stringify({ roomid: data.room, id: socket.id }));
                }
            }
            else {
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
            if (members.size === 0)
                room.delete(roomid);
        }
    });
});
// Broadcast to players in each room
setInterval(() => {
    for (const [id, player] of players.entries()) {
        if (!player.isReady || !player.room)
            continue;
        const members = room.get(player.room);
        if (!members)
            continue;
        const others = Array.from(members)
            .filter((otherId) => otherId !== id)
            .map((otherId) => {
            const other = players.get(otherId);
            if (!other)
                return null;
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
        }
        catch (err) {
            console.error(`❌ Failed to send to player ${id}`, err);
        }
    }
}, 1000 / 60);
// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🟢 Server running at http://localhost:${PORT}`);
});
