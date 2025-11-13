
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const port = process.env.PORT || 8080;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// In-memory storage for rooms. A Map of roomCode -> Set of clients.
const rooms = new Map();

/**
 * Generates a unique 6-character uppercase alphanumeric room code.
 * @returns {string} A unique room code.
 */
const generateRoomCode = () => {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (rooms.has(code));
    return code;
};

wss.on('connection', (ws) => {
    console.log('Client connected');
    let clientRoomCode = null; // Store the room code for this client

    const cleanupClient = () => {
        if (clientRoomCode && rooms.has(clientRoomCode)) {
            const room = rooms.get(clientRoomCode);
            room.delete(ws);
            console.log(`Client removed from room ${clientRoomCode}. Room size: ${room.size}`);
            // If the room is empty, delete it
            if (room.size === 0) {
                rooms.delete(clientRoomCode);
                console.log(`Room ${clientRoomCode} is empty and has been deleted.`);
            }
        }
    };

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data);

            const type = data.type ? data.type.trim() : '';

            if (type === 'host') {
                // A client wants to host a new room.
                cleanupClient(); // Clean up any previous room connection
                const newRoomCode = generateRoomCode();
                rooms.set(newRoomCode, new Set([ws]));
                clientRoomCode = newRoomCode;
                ws.send(JSON.stringify({
                    type: 'hosted',
                    payload: { roomCode: newRoomCode }
                }));
                console.log(`Client hosted new room: ${newRoomCode}`);
            } else if (type === 'join') {
                // A client wants to join an existing room.
                const { roomCode } = data.payload;
                if (rooms.has(roomCode)) {
                    cleanupClient(); // Clean up any previous room connection
                    rooms.get(roomCode).add(ws);
                    clientRoomCode = roomCode;
                    ws.send(JSON.stringify({
                        type: 'joined',
                        payload: { roomCode: roomCode }
                    }));
                    console.log(`Client joined room: ${roomCode}`);
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        payload: { message: `Room with code "${roomCode}" not found.` }
                    }));
                    console.log(`Join failed. Room not found: ${roomCode}`);
                }
            } else if (type === 'shareQueue') {
                // A client is sharing their queue with the room.
                if (clientRoomCode && rooms.has(clientRoomCode)) {
                    const room = rooms.get(clientRoomCode);
                    const messageToSend = JSON.stringify({
                        type: 'queueUpdate',
                        payload: { queue: data.payload.queue }
                    });
                    // Broadcast to everyone else in the room
                    room.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(messageToSend);
                        }
                    });
                    console.log(`Queue shared in room: ${clientRoomCode}`);
                }
            } else if (type === 'shareLibrary') {
                // A client is sharing their library metadata.
                if (clientRoomCode && rooms.has(clientRoomCode)) {
                    const room = rooms.get(clientRoomCode);
                    const messageToSend = JSON.stringify({
                        type: 'libraryUpdate',
                        payload: { library: data.payload.library }
                    });
                    // Broadcast to everyone else in the room
                    room.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(messageToSend);
                        }
                    });
                    console.log(`Library changes broadcasted in room: ${clientRoomCode}`);
                }
            } else if (type === 'sharePlaylist') {
                console.log(`Received sharePlaylist in room ${clientRoomCode}:`, data.payload);
                // Placeholder for future implementation
            } else if (type === 'compareLibraries') {
                console.log(`Received compareLibraries in room ${clientRoomCode}:`, data.payload);
                // Placeholder for future implementation
            } else if (type === 'syncCommon') {
                console.log(`Received syncCommon in room ${clientRoomCode}`);
                // Placeholder for future implementation
            } else if (type === 'leave') {
                // Client explicitly leaves
                cleanupClient();
                clientRoomCode = null;
                ws.send(JSON.stringify({ type: 'left' }));
            } else {
                console.warn('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Failed to parse message or handle client request:', error);
            ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Invalid message format.' }
            }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        cleanupClient();
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        cleanupClient();
    });
});

app.get('/', (req, res) => {
  res.send('Music Sync WebSocket server is running.');
});

server.listen(port, () => {
    console.log(`Server started on port ${port}`);
});