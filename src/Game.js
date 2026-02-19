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
        this.soundManager = null;
        this.lastTime = performance.now();
        this.isMouseDown = false;
        this.isRightMouseDown = false;
        this.walls = [];
        this.bullets = [];
        this.remotePlayers = {};
        this.lastShootTime = 0;
        this.miniMapVisible = true;
        this.debugOverlayVisible = false; // Hidden by default

        this.init();
    }

    init() {
        // Initializer sequence called from constructor
    }

    start() {
        this.initThree();
        this.initWorld();
        this.initPlayer();
        this.initNetwork();
        this.initInputs();
        this.miniMap = new MiniMap(this);
        this.soundManager = new SoundManager();
        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x333333);

        this.renderer = new THREE.WebGLRenderer({ antialias: false });
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
    }

    initNetwork() {
        this.networkManager = new NetworkManager(this);
    }

    initNetwork() {
        this.networkManager = new NetworkManager(this);
    }

    // Removed duplicate execution

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

        // Mouse Input Tracking
        document.addEventListener('mousedown', (event) => {
            if (event.button === 0) {
                // Critical Fix: Register firing state regardless of pointer lock
                // This allows G-key adjustment to detect "Aiming" state correctly
                this.isMouseDown = true;
            }
            if (event.button === 2) {
                this.isRightMouseDown = true;
            }
        });

        document.addEventListener('mouseup', (event) => {
            if (event.button === 0) this.isMouseDown = false;
            if (event.button === 2) this.isRightMouseDown = false;
        });

        document.addEventListener('contextmenu', event => event.preventDefault());

        if (this.player.controls) {
            this.player.controls.addEventListener('lock', () => {
                if (instructions) instructions.style.display = 'none';
                if (blocker) blocker.style.display = 'none';
            });
            this.player.controls.addEventListener('unlock', () => {
                if (this.player.gizmoActive) {
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
                    if (this.player) {
                        this.player.loadFBX(url);
                        if (!this.player.isThirdPerson) {
                            this.player.toggleView();
                        }
                    }
                }
            });
        }

        const textureInput = document.getElementById('texture-upload');
        if (textureInput) {
            textureInput.addEventListener('change', (event) => {
                const file = event.target.files[0];
                if (file) {
                    const url = URL.createObjectURL(file);
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
            case 'KeyV': this.player.toggleView(); break;
            case 'Digit0': this.toggleDebugOverlay(); break; // Toggle Debug Overlay
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
        const { origin, direction, networkOrigin } = this.player.shoot();
        const bullet = new Bullet(this.scene, origin, direction);
        this.bullets.push(bullet);

        if (this.soundManager) {
            this.soundManager.playShootSound();
        }

        const raycaster = new THREE.Raycaster(origin, direction);
        const walls = this.level.getCollidables();
        const wallIntersects = raycaster.intersectObjects(walls);

        const playerMeshes = [];
        Object.values(this.remotePlayers).forEach(p => {
            if (p.mesh) playerMeshes.push(p.mesh);
        });
        const playerIntersects = raycaster.intersectObjects(playerMeshes, true);

        let hit = null;
        let isPlayerHit = false;

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
                if (this.soundManager) this.soundManager.playHitSound();
                if (hit.face) this.createHitEffect(hit.point, hit.face.normal, 0xff0000);

                // SEND HIT EVENT TO NETWORK
                // Get the ID from the hit mesh (we assigned userData.id in createRemotePlayer)
                // Traverse up to find the ID if we hit a child mesh
                let targetId = null;
                let obj = hit.object;
                while (obj) {
                    if (obj.userData && obj.userData.id) {
                        targetId = obj.userData.id;
                        break;
                    }
                    obj = obj.parent;
                }

                if (targetId && this.networkManager) {
                    console.log(`[Game] Hit Player ${targetId}! Sending damage...`);
                    this.networkManager.sendHit(targetId, 10); // Send to server for target

                    // ALSO apply damage locally to the remote player's 3D health bar
                    // This gives immediate visual feedback on the shooter's screen
                    if (this.remotePlayers[targetId]) {
                        this.remotePlayers[targetId].takeDamage(10);
                    }
                }

            } else {
                if (hit.face) this.createHitEffect(hit.point, hit.face.normal, 0xffaa00);
            }
        }

        if (this.networkManager) {
            // Send NETWORK origin (TPS Gun) to other players so it looks correct for them
            this.networkManager.sendShoot(networkOrigin || origin, direction);
        }
    }

    // Called by NetworkManager when 'playerHit' event is received
    handlePlayerHit(data) {
        // data: { targetId, damage, shooterId }
        console.log('[Game] Handle Player Hit:', data);

        if (this.player && this.networkManager && data.targetId === this.networkManager.id) {
            // It's ME! I took damage from another player.
            this.player.takeDamage(data.damage);
        }
        // NOTE: Remote player damage is applied directly in handleShoot() for immediate feedback.
        // No need to apply again here to avoid double damage.
    }

    createRemotePlayer(id, state) {
        console.log(`[Game] Creating Remote Player: ${id}`, state);
        // FIXED: Constructor is (game, id, isLocal)
        const remotePlayer = new Player(this, id, false);

        // Initialize position/rotation immediately
        if (state) {
            remotePlayer.mesh.position.copy(state.position);
            remotePlayer.mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
            console.log(`[Game] Remote Player ${id} initial pos:`, state.position);
        }

        // CRITICAL: Assign ID to mesh for Raycasting Hit Detection
        remotePlayer.mesh.userData.id = id;

        // Also ensure children get the ID (SkinnedMeshes often block the root)
        remotePlayer.mesh.traverse((child) => {
            if (child.isMesh) {
                child.userData.id = id;
            }
        });

        // Add to remotePlayers list
        this.remotePlayers[id] = remotePlayer;
        console.log(`[Game] Remote Player Count now: ${Object.keys(this.remotePlayers).length}`);
        return remotePlayer;
    }

    removeRemotePlayer(player) {
        if (player) {
            console.log(`[Game] Removing Remote Player: ${player.id}`);
            this.scene.remove(player.mesh);
            if (player.id && this.remotePlayers[player.id]) {
                delete this.remotePlayers[player.id];
            }
        }
    }

    createRemoteBullet(id, networkOrigin, networkDirection) {
        let spawnOrigin;
        let spawnDirection;

        // Trigger Animation on Remote Player & Force Mesh Rotation
        if (id && this.remotePlayers[id]) {
            const player = this.remotePlayers[id];
            // Force mesh to face aim direction (fixes 45-deg strafing offset)
            player.triggerShootAnimation(new THREE.Vector3(networkDirection.x, networkDirection.y, networkDirection.z));
        }

        // Use NETWORK values for both origin and direction (Ground Truth from Shooter)
        spawnOrigin = new THREE.Vector3(networkOrigin.x, networkOrigin.y, networkOrigin.z);
        spawnDirection = new THREE.Vector3(networkDirection.x, networkDirection.y, networkDirection.z);

        const bullet = new Bullet(this.scene, spawnOrigin, spawnDirection);
        this.bullets.push(bullet);
        if (this.soundManager) this.soundManager.playShootSound();
    }

    createHitEffect(position, normal, color = 0xffaa00) {
        const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const material = new THREE.MeshBasicMaterial({ color: color });
        const particle = new THREE.Mesh(geometry, material);
        particle.position.copy(position);
        particle.lookAt(position.clone().add(normal));
        this.scene.add(particle);
        setTimeout(() => this.scene.remove(particle), 500);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const time = performance.now();
        const delta = (time - this.lastTime) / 1000;
        this.lastTime = time;

        if (this.player) {
            this.player.update(delta, this.level.getCollidables(), this.isMouseDown);

            if (this.isMouseDown && time > this.lastShootTime + 150) {
                try {
                    this.handleShoot();
                } catch (e) {
                    console.error('[Game] handleShoot error:', e);
                } finally {
                    this.lastShootTime = time;
                }
            }

            if (this.debugOverlayVisible) {
                updateDebugOverlay(this.player);
            }

            if (this.networkManager && this.networkManager.id) {
                // Calculate Pitch for Network Sync
                const dir = new THREE.Vector3();
                this.player.camera.getWorldDirection(dir);
                const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));

                this.networkManager.sendState({
                    position: this.player.getPosition(),
                    rotation: this.player.getRotation(),
                    action: this.player.currentAction,
                    isFiring: this.isMouseDown, // Send firing state
                    pitch: pitch, // Send look pitch
                    gunPos: this.player.aimingTransform?.pos, // Send Custom Gun Offset
                    gunRot: this.player.aimingTransform?.rot,
                    health: this.player.health,
                    maxHealth: this.player.maxHealth
                });
            }

            if (this.player.camera) {
                this.renderer.render(this.scene, this.player.camera);
            }

            Object.values(this.remotePlayers).forEach(p => p.update(delta));
            this.bullets.forEach(b => b.update(delta));
            this.bullets = this.bullets.filter(b => b.alive);
            if (this.miniMap) this.miniMap.update();

            // Update HUD Health Bar
            this.updateHUD();
        }
    }

    toggleDebugOverlay() {
        this.debugOverlayVisible = !this.debugOverlayVisible;
        const overlay = document.getElementById('debug-overlay');
        if (overlay) {
            overlay.style.display = this.debugOverlayVisible ? 'block' : 'none';
        }
    }

    updateHUD() {
        try {
            if (!this.player) return;
            const hp = Math.max(0, this.player.health);
            const maxHp = this.player.maxHealth;
            const pct = (hp / maxHp) * 100;

            const fill = document.getElementById('health-bar-fill');
            const text = document.getElementById('health-text');
            if (fill) {
                fill.style.width = pct + '%';
                if (pct > 50) {
                    fill.style.background = 'linear-gradient(180deg, #44ff44 0%, #22aa22 100%)';
                } else if (pct > 25) {
                    fill.style.background = 'linear-gradient(180deg, #ff8800 0%, #cc6600 100%)';
                } else {
                    fill.style.background = 'linear-gradient(180deg, #ff2222 0%, #880000 100%)';
                }
            }
            if (text) {
                text.textContent = Math.ceil(hp);
            }
        } catch (e) {
            // Silently fail to avoid crashing game loop
        }
    }
}
