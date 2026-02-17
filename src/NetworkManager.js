import { io } from 'socket.io-client';

export class NetworkManager {
    constructor(game) {
        this.game = game;
        // Connect to the same host as the web page, but on port 3000
        const serverUrl = `http://${window.location.hostname}:3000`;
        this.socket = io(serverUrl);
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
                this.game.createRemoteBullet(data.id, data.origin, data.direction);
            }
        });

        this.socket.on('playerHit', (data) => {
            // data contains { targetId, damage, shooterId }
            console.log('[Network] Received playerHit:', data);
            if (this.game.handlePlayerHit) {
                this.game.handlePlayerHit(data);
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

    sendHit(targetId, damage) {
        // Send 'hit' event to server
        this.socket.emit('hit', { targetId, damage });
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
        if (player && player.updateRemoteState) {
            player.updateRemoteState(state);
        } else if (player) {
            // Fallback if method not ready
            player.mesh.position.copy(state.position);
            player.mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
            if (player.setAnimationAction && state.action) {
                player.setAnimationAction(state.action);
            }
        }
    }
}
