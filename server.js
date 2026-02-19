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

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

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
    // Broadcast damage to ALL clients so everyone can update health bars
    io.emit('playerHit', { targetId: data.targetId, damage: data.damage, shooterId: socket.id });
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.io server running on http://0.0.0.0:${PORT}`);
});
