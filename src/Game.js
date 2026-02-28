import * as THREE from 'three';
import { Player } from './Player.js';
import { Level } from './Level.js';
import { NetworkManager } from './NetworkManager.js';
import { Bullet } from './Bullet.js';
import { MiniMap } from './MiniMap.js';
import { SoundManager } from './SoundManager.js';
import { updateDebugOverlay } from './DebugOverlay.js';
import { PhysicsManager } from './PhysicsManager.js';
import { Enemy } from './Enemy.js';
import { BossEnemy } from './BossEnemy.js'; // Added BossEnemy import
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HomingMissile } from './HomingMissile.js';
import { VFXManager } from './VFXManager.js';

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
        this.projectiles = []; // For homing missiles and other entities
        this.enemies = [];
        this.enemyAssets = null; // Store cached FBX models for cloning
        this.remotePlayers = {};
        this.lastShootTime = 0;
        this.miniMapVisible = true;
        this.debugOverlayVisible = false; // Hidden by default

        this.init();
    }

    init() {
        // Initializer sequence called from constructor
    }

    async start() {
        this.initThree();
        this.initWorld();
        this.initPlayer();
        this.initNetwork();
        this.initInputs();
        this.miniMap = new MiniMap(this);
        this.soundManager = new SoundManager();

        // Initialize Rapier.js Physics
        this.physicsManager = new PhysicsManager();
        await this.physicsManager.init();

        // Initialize VFX particle system
        this.vfx = new VFXManager(this.scene);

        // Start animation immediately so the screen doesn't stay black
        this.animate();

        // Load 40MB of enemy assets in the background, then spawn them
        this.loadEnemyAssets().then(() => {
            this.initEnemies();
        });
    }

    async loadEnemyAssets() {
        return new Promise((resolve) => {
            const fbxLoader = new FBXLoader();
            const tgaLoader = new TGALoader();
            this.enemyAssets = { animations: {} };

            let loadedCount = 0;
            const checkDone = () => {
                loadedCount++;
                if (loadedCount >= 6) resolve(); // Added roar and treasure
            };

            console.log('[Game] Loading centralized enemy assets...');

            // 1. Load Walk Model
            fbxLoader.load('/models/enemy/MutantWalking_Anim.FBX', (object) => {
                this.enemyAssets.walkModel = object;
                if (object.animations.length > 0) {
                    this.enemyAssets.animations['Walk'] = object.animations[0];
                }
                checkDone();
            }, undefined, (err) => {
                console.error('[Game] Failed to load Walking FBX:', err);
                checkDone();
            });

            // 2. Load Swipe Animation
            fbxLoader.load('/models/enemy/MutantSwiping_Anim.FBX', (object) => {
                if (object.animations.length > 0) {
                    this.enemyAssets.animations['Attack'] = object.animations[0];
                }
                checkDone();
            }, undefined, (err) => {
                console.error('[Game] Failed to load Swiping FBX:', err);
                checkDone();
            });

            // 3. Load Death Animation
            fbxLoader.load('/models/enemy/SwordAndShieldDeath_UE.FBX', (object) => {
                if (object.animations.length > 0) {
                    this.enemyAssets.animations['Death'] = object.animations[0];
                }
                checkDone();
            }, undefined, (err) => {
                console.error('[Game] Failed to load Death FBX:', err);
                checkDone();
            });

            // 4. Load Roar Animation (For Boss Alert)
            fbxLoader.load('/models/enemy/MutantRoaring.FBX', (object) => {
                if (object.animations.length > 0) {
                    this.enemyAssets.animations['Roar'] = object.animations[0];
                }
                checkDone();
            }, undefined, (err) => {
                console.error('[Game] Failed to load Roar FBX:', err);
                checkDone();
            });

            // 5. Load Treasure FBX
            fbxLoader.load('/models/enemy/Kongou123.FBX', (object) => {
                this.enemyAssets.treasureModel = object;
                checkDone();
            }, undefined, (err) => {
                console.error('[Game] Failed to load Treasure FBX:', err);
                checkDone();
            });

            // 3. Load Texture
            tgaLoader.load('/models/enemy/Kongou999.TGA', (texture) => {
                this.enemyAssets.texture = texture;
                checkDone();
            }, undefined, (err) => {
                console.error('[Game] Failed to load Kongou999.TGA texture (Missing file?):', err);
                checkDone();
            });
        });
    }

    initEnemies() {
        // Spawn 1 Giant Boss in the central plaza (approx map center)
        const mapWidth = 16 * 5; // 80
        const mapHeight = 16 * 5; // 80
        const centerPos = new THREE.Vector3(mapWidth / 2, 0, mapHeight / 2);

        // Make Boss
        const boss = new BossEnemy(this, centerPos, "boss_1", this.enemyAssets);
        this.enemies.push(boss);

        // Add Rotating Treasure above Boss
        if (this.enemyAssets.treasureModel) {
            this.treasureObj = SkeletonUtils.clone(this.enemyAssets.treasureModel);
            this.treasureObj.position.copy(centerPos);
            this.treasureObj.position.y = 8; // Slightly higher than the 3x scaled boss

            // Adjust materials if needed
            this.treasureObj.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    // Give it a glowing golden look
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xffd700,
                        emissive: 0xaa6600,
                        emissiveIntensity: 0.5,
                        metalness: 1.0,
                        roughness: 0.2
                    });
                }
            });
            this.scene.add(this.treasureObj);

            // Add a yellow point light to the treasure
            const treasureLight = new THREE.PointLight(0xffa500, 10, 15);
            treasureLight.position.copy(this.treasureObj.position);
            this.scene.add(treasureLight);
        }
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x333333);

        // Pre-allocate geometry and materials for hit effects to prevent shooting stutter (GPU uploads)
        this.hitGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        this.hitMaterialRed = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        this.hitMaterialOrange = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

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

        // Muzzle flash VFX at the gun barrel position (wrapped in try/catch to never break shooting)
        try { if (this.vfx) this.vfx.muzzleFlash(origin); } catch (e) { console.warn('VFX muzzleFlash error:', e); }
        const bullet = new Bullet(this.scene, origin, direction);
        this.bullets.push(bullet);

        const raycaster = new THREE.Raycaster(origin, direction);
        const walls = this.level.getCollidables();
        const wallIntersects = raycaster.intersectObjects(walls);

        const targetMeshes = [];
        Object.values(this.remotePlayers).forEach(p => {
            if (p.mesh) targetMeshes.push(p.mesh);
        });
        // CRITICAL PERFORMANCE FIX: Never push `e.mesh` because Raycasting against 50,000 animating triangles freezes the thread!
        // Instead, deliberately push ONLY the primitive 12-triangle `e.placeholder` collision bounds.
        this.enemies.forEach(e => {
            if (e.placeholder) targetMeshes.push(e.placeholder);
        });
        const targetIntersects = raycaster.intersectObjects(targetMeshes, true);

        let hit = null;
        let isPlayerHit = false;

        if (wallIntersects.length > 0 && targetIntersects.length > 0) {
            if (targetIntersects[0].distance < wallIntersects[0].distance) {
                hit = targetIntersects[0];
                isPlayerHit = true; // Treats both players and enemies as entity hits
            } else {
                hit = wallIntersects[0];
            }
        } else if (targetIntersects.length > 0) {
            hit = targetIntersects[0];
            isPlayerHit = true;
        } else if (wallIntersects.length > 0) {
            hit = wallIntersects[0];
        }

        if (hit && hit.distance < 100) {
            if (isPlayerHit) {
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

                if (targetId) {
                    // Check if it's a remote player
                    if (this.networkManager && this.remotePlayers[targetId]) {
                        console.log(`[Game] Hit Player ${targetId} !Sending damage...`);
                        this.networkManager.sendHit(targetId, 10, direction); // Send direction for ragdoll
                        this.remotePlayers[targetId].takeDamage(10, direction);
                    }
                    // Check if it's an AI enemy
                    else {
                        const hitEnemy = this.enemies.find(e => e.id === targetId);
                        if (hitEnemy) {
                            console.log(`[Game] Hit Enemy ${targetId} !Sending damage to server...`);
                            if (this.networkManager) {
                                this.networkManager.sendHit(targetId, 10, direction);
                            } else {
                                hitEnemy.takeDamage(10, direction); // Offline fallback
                            }
                        }
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
        // data: { targetId, damage, shooterId, direction }
        console.log('[Game] Handle Player Hit:', data);

        const dir = data.direction ? new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z) : null;

        if (this.player && this.networkManager && data.targetId === this.networkManager.id) {
            // It's ME! I took damage from another player.
            this.player.takeDamage(data.damage, dir);
        } else if (data.targetId && this.remotePlayers[data.targetId] && data.shooterId !== (this.networkManager ? this.networkManager.id : null)) {
            // Sync death/damage animation for remote players shot by others
            this.remotePlayers[data.targetId].takeDamage(data.damage, dir);
        } else if (data.targetId && data.targetId.startsWith('enemy_')) {
            // It's an AI enemy taking damage
            const enemy = this.enemies.find(e => e.id === data.targetId);
            if (enemy) {
                enemy.takeDamage(data.damage, dir, data.shooterId);
            }
        }
        // NOTE: Remote player/enemy damage initiated by THIS client is handled either in fallback or network echo.
    }

    handleEnemyStates(states) {
        // Only clients receive and apply these from the Host
        if (this.networkManager && this.networkManager.isHost) return;

        states.forEach(state => {
            const enemy = this.enemies.find(e => e.id === state.id);
            if (enemy && enemy.mesh) {
                // BUG FIX: Do not apply network 'WALK'/'CHASE' states if the local Enemy has already died and is playing 'DEATH'.
                // Applying position/animation here causes the dead mesh to rise back up with sinking feet!
                if (enemy.isDead) return;

                enemy.mesh.position.set(state.pos.x, state.pos.y, state.pos.z);
                enemy.mesh.rotation.y = state.rot;
                if (enemy.setAnimationAction && state.action && enemy.currentAction !== state.action) {
                    enemy.setAnimationAction(state.action);
                }
            }
        });
    }

    createRemotePlayer(id, state) {
        console.log(`[Game] Creating Remote Player: ${id} `, state);
        // FIXED: Constructor is (game, id, isLocal)
        const remotePlayer = new Player(this, id, false);

        // Initialize position/rotation immediately
        if (state) {
            remotePlayer.mesh.position.copy(state.position);
            remotePlayer.mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
            console.log(`[Game] Remote Player ${id} initial pos: `, state.position);
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
        console.log(`[Game] Remote Player Count now: ${Object.keys(this.remotePlayers).length} `);
        return remotePlayer;
    }

    removeRemotePlayer(player) {
        if (player) {
            console.log(`[Game] Removing Remote Player: ${player.id} `);
            player.dispose(); // Call the proper cleanup method to clear physics and scene
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
    }

    createHitEffect(position, normal, color = 0xffaa00) {
        // Use cached geometry and material to avoid massive stuttering on rapid fire
        const material = (color === 0xff0000) ? this.hitMaterialRed : this.hitMaterialOrange;
        const particle = new THREE.Mesh(this.hitGeometry, material);
        particle.position.copy(position);
        particle.lookAt(position.clone().add(normal));
        this.scene.add(particle);
        setTimeout(() => this.scene.remove(particle), 500);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const time = performance.now();
        let delta = (time - this.lastTime) / 1000;
        this.lastTime = time;

        // Cap delta to prevent massive jumps after loading or hiding the browser tab
        if (delta > 0.1) delta = 0.1;

        if (this.player) {
            this.player.update(delta, this.level.getCollidables(), this.isMouseDown);

            // Reverted player attack speed back to 150ms as requested
            if (this.isMouseDown && !this.player.isDead && time > this.lastShootTime + 150) {
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

                // If HOST, broadcast enemy states to sync all clients
                if (this.networkManager.isHost) {
                    const enemyStates = this.enemies.filter(e => e.mesh).map(e => ({
                        id: e.id,
                        pos: { x: e.mesh.position.x, y: e.mesh.position.y, z: e.mesh.position.z },
                        rot: e.mesh.rotation.y,
                        action: e.currentAction
                    }));
                    if (enemyStates.length > 0) {
                        this.networkManager.socket.emit('enemyState', enemyStates);
                    }
                }
            }

            // Update treasure rotation
            if (this.treasureObj) {
                this.treasureObj.rotation.y += delta * 1.0; // Slowly rotate
            }

            if (this.player.camera) {
                this.renderer.render(this.scene, this.player.camera);
            }

            Object.values(this.remotePlayers).forEach(p => p.update(delta));
            this.bullets.forEach(b => b.update(delta));
            this.bullets = this.bullets.filter(b => b.alive);
            this.projectiles.forEach(p => p.update(delta));
            this.projectiles = this.projectiles.filter(p => p.alive);
            this.enemies.forEach(e => e.update(delta));
            if (this.miniMap) this.miniMap.update();
            if (this.vfx) this.vfx.update(delta);

            // Update Physics (Ragdoll)
            if (this.physicsManager) {
                this.physicsManager.update(delta);

                // Send ragdoll state over network if local player is ragdolling
                if (this.networkManager && this.networkManager.id && this.player.isDead) {
                    const ragdollState = this.physicsManager.getRagdollState(this.player.id);
                    if (ragdollState) {
                        this.networkManager.sendRagdollState(ragdollState);
                    }
                }
            }

            // Update ragdoll bone pose (limp animation)
            if (this.player.isDead) {
                this.player.updateRagdollPose(delta);
            }
            Object.values(this.remotePlayers).forEach(p => {
                if (p.isDead) p.updateRagdollPose(delta);
            });

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
