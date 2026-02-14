import * as THREE from 'three';
import { Player } from './Player.js';
import { Level } from './Level.js';
import { NetworkManager } from './NetworkManager.js';
import { Bullet } from './Bullet.js';
import { MiniMap } from './MiniMap.js';

import { SoundManager } from './SoundManager.js';
import { updateDebugOverlay } from './DebugOverlay.js';

export class Game {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.player = null;
        this.level = null;
        this.networkManager = null;
        this.miniMap = null;
        this.soundManager = null; // Add SoundManager
        this.lastTime = performance.now();
        this.remotePlayers = {}; // id -> Player instance
        this.bullets = [];
        this.isMouseDown = false;
        this.lastShootTime = 0;
    }

    start() {
        this.initThree();
        this.initWorld();
        this.initPlayer();
        this.initNetwork();
        this.initInputs();
        this.miniMap = new MiniMap(this);
        this.soundManager = new SoundManager(); // Init
        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x333333); // Back to standard Gray
        // Fog removed to ensure visibility

        this.renderer = new THREE.WebGLRenderer({ antialias: false }); // Pixelated look
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        document.getElementById('game-container').appendChild(this.renderer.domElement);

        window.addEventListener('resize', () => {
            if (this.player && this.player.camera) {
                this.player.camera.aspect = window.innerWidth / window.innerHeight;
                this.player.camera.updateProjectionMatrix();
            }
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    initWorld() {
        this.level = new Level(this.scene);
    }

    initPlayer() {
        this.player = new Player(this, 'local', true);
        // Camera is created in Player init
    }

    initNetwork() {
        this.networkManager = new NetworkManager(this);
    }

    createRemotePlayer(id, state) {
        const remotePlayer = new Player(this, id, false);
        remotePlayer.mesh.position.copy(state.position);
        this.remotePlayers[id] = remotePlayer; // Store Player instance
        return remotePlayer;
    }

    removeRemotePlayer(player) {
        if (player && player.mesh) {
            this.scene.remove(player.mesh);
        }
    }

    initInputs() {
        document.addEventListener('keydown', (event) => this.onKeyDown(event));
        document.addEventListener('keyup', (event) => this.onKeyUp(event));

        const blocker = document.getElementById('blocker');
        const instructions = document.getElementById('instructions');

        if (instructions) {
            instructions.addEventListener('click', () => {
                if (this.player.controls) this.player.controls.lock();
            });
        }

        // Shooting Input (MouseDown)
        // Shooting Input (MouseDown/Up)
        // Mouse Input Tracking
        document.addEventListener('mousedown', (event) => {
            if (event.button === 0) {
                if (this.player.controls && this.player.controls.isLocked) {
                    this.isMouseDown = true;
                }
            }
            if (event.button === 2) { // Right Click
                this.isRightMouseDown = true;
            }
        });
        document.addEventListener('mouseup', (event) => {
            if (event.button === 0) this.isMouseDown = false;
            if (event.button === 2) this.isRightMouseDown = false;
        });
        document.addEventListener('contextmenu', event => event.preventDefault()); // Disable context menu

        if (this.player.controls) {
            this.player.controls.addEventListener('lock', () => {
                console.log('Pointer Locked');
                if (instructions) instructions.style.display = 'none';
                if (blocker) blocker.style.display = 'none';
            });
            this.player.controls.addEventListener('unlock', () => {
                console.log('Pointer Unlocked');
                // Only show pause screen if Gizmo is NOT active
                if (this.player.gizmoActive) {
                    // Gizmo Mode: Keep blocker hidden, or show 'Editing' text?
                    // For now, keep hidden so user can interact with Gizmo
                    if (blocker) blocker.style.display = 'none';
                    if (instructions) instructions.style.display = 'none';
                } else {
                    if (blocker) blocker.style.display = 'flex';
                    if (instructions) {
                        instructions.style.display = 'block';
                        instructions.innerHTML = 'PAUSED<br><span style="font-size: 16px;">CLICK TO RESUME</span>';
                    }
                }
            });
        }

        const uploadInput = document.getElementById('model-upload');
        if (uploadInput) {
            uploadInput.addEventListener('change', (event) => {
                const file = event.target.files[0];
                if (file) {
                    const url = URL.createObjectURL(file);
                    console.log('File selected:', file.name, url);
                    if (this.player) {
                        this.player.loadFBX(url);
                        // Force TPS to see the model?
                        if (!this.player.isThirdPerson) {
                            this.player.toggleView(); // Auto switch to TPS to show model
                            console.log('Auto-switched to TPS to show model');
                        }
                    } else {
                        console.error('Player not initialized yet');
                    }
                }
            });
        }

        // Texture Upload Handler
        const textureInput = document.getElementById('texture-upload');
        if (textureInput) {
            textureInput.addEventListener('change', (event) => {
                const file = event.target.files[0];
                if (file) {
                    const url = URL.createObjectURL(file);
                    console.log('Texture selected:', file.name, url);
                    if (this.player) {
                        this.player.applyTexture(url);
                    }
                }
            });
        }
    }

    onKeyDown(event) {

        this.keys = this.keys || {};
        this.keys[event.code] = true;

        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW': this.player.moveForward = true; break;
            case 'ArrowLeft':
            case 'KeyA': this.player.moveLeft = true; break;
            case 'ArrowDown':
            case 'KeyS': this.player.moveBackward = true; break;
            case 'ArrowRight':
            case 'KeyD': this.player.moveRight = true; break;
            case 'KeyV':
                console.log('V Key Pressed');
                this.player.toggleView();
                break; // Toggle View
        }
    }

    onKeyUp(event) {
        this.keys = this.keys || {};
        this.keys[event.code] = false;

        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW': this.player.moveForward = false; break;
            case 'ArrowLeft':
            case 'KeyA': this.player.moveLeft = false; break;
            case 'ArrowDown':
            case 'KeyS': this.player.moveBackward = false; break;
            case 'ArrowRight':
            case 'KeyD': this.player.moveRight = false; break;
        }
    }

    handleShoot() {
        // Create visual bullet
        const { origin, direction } = this.player.shoot();
        const bullet = new Bullet(this.scene, origin, direction);
        this.bullets.push(bullet);

        // Play Shoot Sound
        if (this.soundManager) {
            this.soundManager.playShootSound();
        }

        // Raycast for instant hit detection (Hitscan style)
        const raycaster = new THREE.Raycaster(origin, direction);

        // 1. Check against walls
        const walls = this.level.getCollidables();
        const wallIntersects = raycaster.intersectObjects(walls);

        // 2. Check against Remote Players
        // Collect meshes from remote players
        const playerMeshes = [];
        Object.values(this.remotePlayers).forEach(p => {
            if (p.mesh) playerMeshes.push(p.mesh);
        });
        const playerIntersects = raycaster.intersectObjects(playerMeshes, true); // Recursive check

        // Determine nearest hit
        let hit = null;
        let isPlayerHit = false;

        // Compare distances if both hit
        if (wallIntersects.length > 0 && playerIntersects.length > 0) {
            if (playerIntersects[0].distance < wallIntersects[0].distance) {
                hit = playerIntersects[0];
                isPlayerHit = true;
            } else {
                hit = wallIntersects[0];
            }
        } else if (playerIntersects.length > 0) {
            hit = playerIntersects[0];
            isPlayerHit = true;
        } else if (wallIntersects.length > 0) {
            hit = wallIntersects[0];
        }

        if (hit && hit.distance < 100) {
            if (isPlayerHit) {
                // Play Hit Sound!
                if (this.soundManager) this.soundManager.playHitSound();
                // Visual effect? Red spark?
                if (hit.face) {
                    this.createHitEffect(hit.point, hit.face.normal, 0xff0000);
                }
            } else {
                // Wall Hit
                if (hit.face) {
                    this.createHitEffect(hit.point, hit.face.normal, 0xffaa00);
                }
            }
        }

        // Broadcast shoot event via NetworkManager
        if (this.networkManager) {
            this.networkManager.sendShoot(origin, direction);
        }
    }

    createRemoteBullet(origin, direction) {
        const originVec = new THREE.Vector3(origin.x, origin.y, origin.z);
        const dirVec = new THREE.Vector3(direction.x, direction.y, direction.z);
        const bullet = new Bullet(this.scene, originVec, dirVec);
        this.bullets.push(bullet);

        // Remote shoot sound
        if (this.soundManager) this.soundManager.playShootSound();
    }

    createHitEffect(position, normal, color = 0xffaa00) {
        const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const material = new THREE.MeshBasicMaterial({ color: color });
        const particle = new THREE.Mesh(geometry, material);
        particle.position.copy(position);
        particle.lookAt(position.clone().add(normal));
        this.scene.add(particle);

        // Simple fade out
        setTimeout(() => {
            this.scene.remove(particle);
        }, 500);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const time = performance.now();
        const delta = (time - this.lastTime) / 1000;
        this.lastTime = time;

        if (this.player) {
            this.player.update(delta, this.level.getCollidables(), this.isMouseDown);

            // Auto-fire Logic
            if (this.isMouseDown && time > this.lastShootTime + 150) { // 150ms cooldown (approx 6.6 rounds/sec)
                this.handleShoot();
                this.lastShootTime = time;
            }

            updateDebugOverlay(this.player);

            // Broadcast state
            if (this.networkManager && this.networkManager.id) {
                this.networkManager.sendState({
                    position: this.player.getPosition(),
                    rotation: {
                        x: this.player.getRotation().x,
                        y: this.player.getRotation().y,
                        z: this.player.getRotation().z
                    },
                    action: this.player.currentAction
                });
            }

            if (this.player.camera) {
                this.renderer.render(this.scene, this.player.camera);
            }

            // Update remote players (animations)
            Object.values(this.remotePlayers).forEach(p => p.update(delta));

            // Update bullets
            this.bullets.forEach(b => b.update(delta));
            this.bullets = this.bullets.filter(b => b.alive);

            // Update MiniMap
            if (this.miniMap) this.miniMap.update();
        }
    }
}
