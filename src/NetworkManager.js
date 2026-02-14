import { io } from 'socket.io-client';

export class NetworkManager {
    constructor(game) {
        this.game = game;
        this.socket = io('http://localhost:3000'); // Connect to local server
        this.id = null;
        this.remotePlayers = {}; // Map of id -> mesh/player object

        this.setupSocket();
    }

    setupSocket() {
        this.socket.on('connect', () => {
            console.log('Connected to server, ID:', this.socket.id);
            this.id = this.socket.id;
        });

        this.socket.on('players', (serverPlayers) => {
            // Initial load of existing players
            for (const id in serverPlayers) {
                if (id !== this.id) {
                    this.addRemotePlayer(id, serverPlayers[id]);
                }
            }
        });

        this.socket.on('playerConnected', (data) => {
            if (data.id !== this.id) {
                this.addRemotePlayer(data.id, data.state);
            }
        });

        this.socket.on('playerDisconnected', (id) => {
            this.removeRemotePlayer(id);
        });

        this.socket.on('playerUpdated', (data) => {
            if (this.remotePlayers[data.id]) {
                this.updateRemotePlayer(data.id, data.state);
            }
        });

        this.socket.on('playerShoot', (data) => {
            // data contains { id, origin, direction }
            if (data.id !== this.id) {
                this.game.createRemoteBullet(data.origin, data.direction);
            }
        });
    }

    sendState(state) {
        // State includes position, rotation, action
        this.socket.emit('updateState', state);
    }

    sendShoot(origin, direction) {
        this.socket.emit('shoot', { origin, direction });
    }

    addRemotePlayer(id, state) {
        console.log('Adding remote player:', id);
        // Delegate creation to Game or directly create mesh here
        // For now, let's call a method in Game to spawn a remote player
        this.remotePlayers[id] = this.game.createRemotePlayer(id, state);
    }

    removeRemotePlayer(id) {
        if (this.remotePlayers[id]) {
            this.game.removeRemotePlayer(this.remotePlayers[id]);
            delete this.remotePlayers[id];
        }
    }

    updateRemotePlayer(id, state) {
        const player = this.remotePlayers[id];
        if (player) {
            // Smooth interpolation could be added here
            player.mesh.position.copy(state.position);
            player.mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);

            if (player.setAnimationAction && state.action) {
                player.setAnimationAction(state.action);
            }
        }
    }
}
