import { createServer } from 'http';
import { Server } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all origins for simplicity in dev
    methods: ["GET", "POST"]
  }
});

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'src', 'config', 'weapon.json');

// Ensure config directory exists
const configDir = path.dirname(CONFIG_PATH);
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// API to SAVE config
httpServer.on('request', (req, res) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/save-weapon-config') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        // Validate JSON
        JSON.parse(body);
        fs.writeFileSync(CONFIG_PATH, body);
        console.log('Weapon config saved to:', CONFIG_PATH);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('Error saving config:', e);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
  }
  else if (req.method === 'GET' && req.url === '/api/get-weapon-config') {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end('{}');
    }
  }
});

const players = {};

let hostId = null;

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Assign Host role
  if (!hostId) {
    hostId = socket.id;
    console.log(`Assigned HOST role to: ${hostId}`);
  }
  socket.emit('setHost', hostId === socket.id);

  // Initialize new player
  if (!players[socket.id]) {
    players[socket.id] = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      action: 'Idle' // animation state
    };
  }

  // Send existings players to new player
  socket.emit('players', players);

  // Notify others about new player
  socket.broadcast.emit('playerConnected', { id: socket.id, state: players[socket.id] });

  socket.on('updateState', (state) => {
    if (players[socket.id]) {
      players[socket.id] = state;
      // Broadcast update to everyone else
      socket.broadcast.emit('playerUpdated', { id: socket.id, state: state });
    }
  });

  socket.on('shoot', (data) => {
    // Broadcast shoot event
    socket.broadcast.emit('playerShoot', { id: socket.id, origin: data.origin, direction: data.direction });
  });

  socket.on('hit', (data) => {
    // Broadcast damage to ALL clients with direction for ragdoll
    io.emit('playerHit', {
      targetId: data.targetId,
      damage: data.damage,
      shooterId: socket.id,
      direction: data.direction || null
    });
  });

  socket.on('ragdollUpdate', (data) => {
    // Relay ragdoll state to all other clients
    socket.broadcast.emit('ragdollUpdate', { id: socket.id, ragdollState: data.ragdollState });
  });

  socket.on('enemyState', (states) => {
    // Relay enemy states from Host to all other clients
    socket.broadcast.emit('enemyState', states);
  });

  socket.on('ragdollEnd', (data) => {
    // Notify all other clients that ragdoll has ended
    socket.broadcast.emit('ragdollEnd', { id: socket.id });
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);

    // Reassign host if necessary
    if (socket.id === hostId) {
      const remainingPlayers = Object.keys(players);
      if (remainingPlayers.length > 0) {
        hostId = remainingPlayers[0];
        console.log(`Re-assigned HOST role to: ${hostId}`);
        io.to(hostId).emit('setHost', true);
      } else {
        hostId = null;
      }
    }
  });
});

const PORT = 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.io server running on http://0.0.0.0:${PORT}`);
});
