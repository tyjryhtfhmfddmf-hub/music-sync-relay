
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const port = process.env.PORT || 8080;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// In-memory storage for rooms. A Map of roomCode -> Set of clients.
const rooms = new Map();

const getSongKey = (song) => {
    // Fallback for older song objects that might not have a clean title/artist
    const title = song.title || 'Unknown Title';
    const artist = song.artist || 'Unknown Artist';
    return `${title.trim()}-${artist.trim()}`.toLowerCase();
};

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

let nextClientId = 1;

wss.on('connection', (ws) => {
    ws.id = nextClientId++;
    console.log(`Client connected with id ${ws.id}`);
    ws.send(JSON.stringify({ type: 'connected', payload: { id: ws.id } }));

    let clientRoomCode = null; // Store the room code for this client
    ws.library = []; // Add a library property to the WebSocket client
    ws.songKeys = new Set(); // Store a set of song keys for efficient lookup

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
                    const room = rooms.get(roomCode);
                    // Notify existing clients to share their library for the newcomer
                    const requestMessage = JSON.stringify({ type: 'requestLibraryShare' });
                    room.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(requestMessage);
                        }
                    });

                    cleanupClient(); // Clean up any previous room connection
                    room.add(ws);
                    clientRoomCode = roomCode;
                    ws.send(JSON.stringify({
                        type: 'joined',
                        payload: { roomCode: roomCode }
                    }));
                    console.log(`Client joined room: ${roomCode}, requested library share.`);
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
                // A client is sharing their library metadata, store it.
                const receivedLibrary = data.payload.library || [];
                ws.library = receivedLibrary;
                ws.songKeys = new Set(receivedLibrary.map(getSongKey));

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
                if (clientRoomCode && rooms.has(clientRoomCode)) {
                    const room = rooms.get(clientRoomCode);
                    const messageToSend = JSON.stringify({
                        type: 'playlistUpdate',
                        payload: { playlist: data.payload.playlist }
                    });
                    // Broadcast to everyone else in the room
                    room.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(messageToSend);
                        }
                    });
                    console.log(`Playlist shared in room: ${clientRoomCode}`);
                }
            } else if (type === 'compareLibraries') {
                if (clientRoomCode && rooms.has(clientRoomCode)) {
                    const room = rooms.get(clientRoomCode);
                    const senderLibrary = data.payload.library || [];
                    
                    if (room.size < 2) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            payload: { message: 'You are the only one in the room.' }
                        }));
                        return;
                    }

                    // For simplicity, this example compares the sender with the *first* other user.
                    // A more complex implementation might let the user choose who to compare with.
                    const otherClient = [...room].find(client => client !== ws);

                    if (otherClient && otherClient.library && otherClient.library.length > 0) {
                        const remoteLibrary = otherClient.library;

                        const senderSongIds = new Set(senderLibrary.map(s => s.id));
                        const remoteSongIds = new Set(remoteLibrary.map(s => s.id));

                        const commonSongs = senderLibrary.filter(song => remoteSongIds.has(song.id));
                        const localOnlySongs = senderLibrary.filter(song => !remoteSongIds.has(song.id));
                        const remoteOnlySongs = remoteLibrary.filter(song => !senderSongIds.has(song.id));
                        
                        const localPercentage = senderLibrary.length > 0 ? (commonSongs.length / senderLibrary.length) * 100 : 0;
                        const remotePercentage = remoteLibrary.length > 0 ? (commonSongs.length / remoteLibrary.length) * 100 : 0;

                        const results = {
                            localUser: 'You',
                            remoteUser: 'User 2', // Generic name, could be improved with user profiles
                            commonSongs,
                            localOnlySongs,
                            remoteOnlySongs,
                            localPercentage: localPercentage.toFixed(0),
                            remotePercentage: remotePercentage.toFixed(0),
                        };
                        
                        ws.send(JSON.stringify({
                            type: 'comparisonResult',
                            payload: { results }
                        }));

                    } else {
                         ws.send(JSON.stringify({
                            type: 'error',
                            payload: { message: 'No other users with a shared library found to compare with.' }
                        }));
                    }
                }
            } else if (type === 'syncCommon') {
                if (clientRoomCode && rooms.has(clientRoomCode)) {
                    const room = rooms.get(clientRoomCode);
                    const allLibraries = [];
                    room.forEach(client => {
                        if (client.library && client.library.length > 0) {
                            allLibraries.push(client.library);
                        }
                    });

                    if (allLibraries.length < 2) {
                        console.log('Not enough libraries to compare for syncCommon.');
                        return; // Or send a message back to the user
                    }

                    // Find the intersection of all libraries
                    const commonSongs = allLibraries.reduce((acc, library) => {
                        const songIds = new Set(library.map(s => s.id));
                        return acc.filter(song => songIds.has(song.id));
                    });

                    // Shuffle the common songs
                    for (let i = commonSongs.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [commonSongs[i], commonSongs[j]] = [commonSongs[j], commonSongs[i]];
                    }

                    const commonSongIds = commonSongs.map(s => s.id);
                    
                    const messageToSend = JSON.stringify({
                        type: 'queueUpdate',
                        payload: { queue: commonSongIds }
                    });

                    // Broadcast the new queue to everyone in the room
                    room.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(messageToSend);
                        }
                    });

                    console.log(`Synced common songs and updated queue for room: ${clientRoomCode}`);
                }
            } else if (type === 'requestSongFile') {
                if (clientRoomCode && rooms.has(clientRoomCode)) {
                    const room = rooms.get(clientRoomCode);
                    const { songKey } = data.payload;

                    // Find a client in the room who has the song
                    const songOwner = [...room].find(client => client.songKeys.has(songKey) && client !== ws);

                    if (songOwner) {
                        // Forward the request to the owner
                        const messageToSend = JSON.stringify({
                            type: 'requestSongFile',
                            payload: {
                                songKey,
                                requester: ws.id
                            }
                        });
                        songOwner.send(messageToSend);
                        console.log(`Forwarded song request for "${songKey}" from client ${ws.id} to ${songOwner.id}`);
                    } else {
                        // Nobody in the room has the song
                        ws.send(JSON.stringify({
                            type: 'error',
                            payload: { message: `Song "${songKey}" not found in this room.` }
                        }));
                        console.log(`Song request failed: "${songKey}" not found in room ${clientRoomCode}`);
                    }
                }
            } else if (type === 'songFileChunk') {
                if (clientRoomCode && rooms.has(clientRoomCode)) {
                    const room = rooms.get(clientRoomCode);
                    // Find the original requester
                    const requester = [...room].find(client => client.id === data.payload.requester);
                    if (requester) {
                        // Send the chunk to the requester
                        requester.send(JSON.stringify({
                            type: 'songFileChunk',
                            payload: data.payload
                        }));
                    }
                }
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