import { createServer } from 'http';
import { Server } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all origins for simplicity in dev
    methods: ["GET", "POST"]
  }
});

const players = {};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Initialize new player
  players[socket.id] = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    action: 'Idle' // animation state
  };

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

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = 3000;
httpServer.listen(PORT, () => {
  console.log(`Socket.io server running on http://localhost:${PORT}`);
});
