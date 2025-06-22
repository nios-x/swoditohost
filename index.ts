import { randomUUID } from "crypto";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";

// --- Setup for __dirname in ES module ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");

// --- Content-Type helper ---
const getContentType = (ext: string) => {
    const map: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".ico": "image/x-icon",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
    };
    return map[ext] || "application/octet-stream";
};

// --- HTTP Server for React files ---
const httpServer = http.createServer((req, res) => {
    const parsedUrl = req.url || "/";
    const safePath = parsedUrl.split("?")[0]; // Remove query params
    let filePath = path.join(distDir, safePath === "/" ? "/index.html" : safePath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            // Fallback to index.html for SPA
            filePath = path.join(distDir, "index.html");
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end("500 Internal Server Error");
                return;
            }

            const ext = path.extname(filePath);
            const contentType = getContentType(ext);

            res.writeHead(200, {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            });
            res.end(data);
        });
    });
});

// --- WebSocket Server Setup ---
interface Socket extends WebSocket {
    id: string;
}

interface Players {
    name?: string;
    socket: Socket;
    coordinates: { x: number; y: number; z: number };
    isReady: boolean;
    isRunning: boolean;
    direction: number;
    room: null | string;
}

const players = new Map<string, Players>();
const room = new Map<string, Set<string>>();

const ws = new WebSocketServer({ server: httpServer });

ws.on("connection", (_socket) => {
    const id = randomUUID();
    const socket = _socket as Socket;
    socket.id = id;

    players.set(id, {
        socket,
        coordinates: { x: 500, y: 500, z: 0 },
        direction: 0,
        room: null,
        isReady: false,
        isRunning: false,
    });

    socket.on("message", async (res) => {
        const data = JSON.parse(res.toString());

        if (data.pos) {
            const player = players.get(socket.id);
            if (player) {
                player.coordinates = {
                    x: data.pos.x,
                    y: data.pos.y,
                    z: data.pos.z,
                };
                player.direction = data.pos.direction;
                player.isRunning = data.pos.isRunning;
            }
        } else if (typeof data.room === "string" && data.name) {
            const player = players.get(socket.id);
            if (!player) return;

            player.name = data.name;

            if (room.has(data.room)) {
                const members = room.get(data.room)!;
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
            if (members.size === 0) {
                room.delete(roomid);
            }
        }
    });
});

// --- Broadcast positions to all players in room ---
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
            player.socket.send(
                JSON.stringify({
                    type: "others",
                    players: others,
                })
            );
        } catch (err) {
            console.error(`Failed to send to player ${id}`, err);
        }
    }
}, 1000 / 30);
const PORT = process.env.PORT || 3000
// --- Start the server ---
httpServer.listen(PORT, () => {
    console.log("Server listening on http://localhost:3000");
});
