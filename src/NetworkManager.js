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
            // data contains { targetId, damage, shooterId, direction }
            console.log('[Network] Received playerHit:', data);
            if (this.game.handlePlayerHit) {
                this.game.handlePlayerHit(data);
            }
        });

        this.socket.on('ragdollUpdate', (data) => {
            // data: { id, ragdollState }
            if (data.id !== this.id && this.game.physicsManager) {
                const player = this.remotePlayers[data.id];
                if (player) {
                    // Stop animations during ragdoll
                    if (player.mixer) player.mixer.stopAllAction();
                    // Hide weapon during ragdoll
                    if (player.weapon) player.weapon.visible = false;
                    if (player.healthBarSprite) player.healthBarSprite.visible = false;
                    // PhysicsManager moves the mesh with hips body
                    this.game.physicsManager.updateRagdollFromState(data.id, data.ragdollState, this.game.scene, player.mesh);
                }
            }
        });

        this.socket.on('ragdollEnd', (data) => {
            // data: { id }
            if (data.id !== this.id && this.game.physicsManager) {
                this.game.physicsManager.removeRagdoll(data.id);
                const player = this.remotePlayers[data.id];
                if (player) {
                    if (player.mesh) {
                        player.mesh.visible = true;
                        player.mesh.quaternion.identity(); // Reset tumbled rotation
                    }
                    if (player.weapon) player.weapon.visible = true;
                    if (player.healthBarSprite) player.healthBarSprite.visible = true;
                }
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

    sendHit(targetId, damage, direction) {
        // Send 'hit' event to server with direction for ragdoll
        const dir = direction ? { x: direction.x, y: direction.y, z: direction.z } : null;
        this.socket.emit('hit', { targetId, damage, direction: dir });
    }

    sendRagdollState(ragdollState) {
        this.socket.emit('ragdollUpdate', { ragdollState });
    }

    sendRagdollEnd() {
        this.socket.emit('ragdollEnd', {});
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
