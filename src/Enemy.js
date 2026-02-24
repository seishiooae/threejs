import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export class Enemy {
    constructor(game, position, id, assets) {
        this.game = game;
        this.id = id;
        this.assets = assets;

        // --- State Machine ---
        // 'WALK', 'CHASE', 'ATTACK', 'DEAD'
        this.state = 'WALK';

        this.health = 50; // 50 HP for example
        this.maxHealth = 50;
        this.isDead = false;
        this.isReady = false; // Prevent AI from running until 40MB models are fully loaded

        this.mesh = new THREE.Group();
        this.mesh.position.copy(position);

        // Random initial rotation
        this.mesh.rotation.y = Math.random() * Math.PI * 2;

        this.game.scene.add(this.mesh);

        this.mixer = null;
        this.animations = {};
        this.currentAction = null;

        // Adjusted walk speed higher per request (1.7x of original 0.35)
        this.walkSpeed = 0.60;
        this.turnSpeed = 1.5;

        // Add a placeholder box until FBX loads
        this.createPlaceholder();

        this.loadModels();

        // Used for wandering
        this.wanderDirection = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
        this.changeDirectionTimer = 0;

        // Audio
        this.hitAudio = new Audio('/models/enemy/punch_robot.WAV');
        this.deathAudio = new Audio('/models/enemy/devil_scared2.WAV');
    }

    createPlaceholder() {
        // Red box placeholder
        const geometry = new THREE.BoxGeometry(1, 2, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        this.placeholder = new THREE.Mesh(geometry, material);
        this.placeholder.position.y = 1;
        this.mesh.add(this.placeholder);

        // Add ID tag for hit detection
        this.placeholder.userData.id = this.id;
        this.placeholder.userData.isEnemy = true;
        this.mesh.userData.id = this.id;
        this.mesh.userData.isEnemy = true;
    }

    loadModels() {
        if (!this.assets || !this.assets.walkModel) {
            console.error(`[Enemy ${this.id}] Assets not provided!`);
            return;
        }

        // Clone the pre-loaded 3D Model so each enemy gets their own mesh but shares memory
        const object = SkeletonUtils.clone(this.assets.walkModel);

        console.log(`[Enemy ${this.id}] Cloned Walking FBX`);

        // Instead of removing the placeholder, we make it completely invisible.
        // We MUST keep it because THREE.js Raycaster fails against moving SkinnedMesh bones (it hits the invisible static T-Pose).
        // By keeping this BoxGeometry alive, we get perfect Doom-like hit detection!
        if (this.placeholder) {
            this.placeholder.material.transparent = true;
            this.placeholder.material.opacity = 0;
            this.placeholder.material.depthWrite = false;
        }

        // User requested exactly half the size of the previous iteration
        const scale = 0.000185; // 0.00037 / 2
        object.scale.set(scale, scale, scale);

        // Setup hierarchy for Z-up to Y-up rotation
        this.modelWrapper = new THREE.Group();
        this.modelWrapper.rotation.x = -Math.PI / 2;
        this.modelWrapper.add(object);

        // Auto-center feet to Ground
        this.modelWrapper.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(this.modelWrapper);
        // We add the absolute value of the lowest point to shift the model up so feet sit on Y=0
        this.modelWrapper.position.y = Math.abs(box.min.y) - 0.05; // Slightly lowered so feet touch the ground

        // Hide wrapper initially to prevent the T-Pose flicker (MUST be done after Box3 calculation or geometry may be skipped)
        this.modelWrapper.visible = false;

        // Apply hostile dark material and TGA Texture
        object.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                child.material = new THREE.MeshStandardMaterial({
                    color: 0xffffff, // White because we mapped a texture
                    roughness: 0.8,
                    metalness: 0.1,
                    side: THREE.DoubleSide
                });

                if (this.assets.texture) {
                    child.material.map = this.assets.texture;
                    child.material.needsUpdate = true;
                }

                child.userData.id = this.id;
                child.userData.isEnemy = true;
            }
        });

        this.mesh.add(this.modelWrapper);

        // Setup Animations
        this.mixer = new THREE.AnimationMixer(object);

        // 1. Walk Animation
        if (this.assets.animations['Walk']) {
            const walkAction = this.mixer.clipAction(this.assets.animations['Walk']);
            this.animations['Walk'] = walkAction;
            walkAction.play();
            this.currentAction = 'Walk';

            // Reveal the model shortly after the Walking animation starts to hide the T-Pose
            setTimeout(() => {
                if (this.modelWrapper && !this.isDead) {
                    this.modelWrapper.visible = true;
                }
            }, 100);
        }

        // 2. Swiping/Attack Animation
        if (this.assets.animations['Attack']) {
            const swipeAction = this.mixer.clipAction(this.assets.animations['Attack']);
            swipeAction.setLoop(THREE.LoopOnce);
            swipeAction.clampWhenFinished = true;
            this.animations['Attack'] = swipeAction;
            console.log(`[Enemy ${this.id}] Attack Animation Linked`);
        }

        // 3. Death Animation
        if (this.assets.animations['Death']) {
            const deathAction = this.mixer.clipAction(this.assets.animations['Death']);
            deathAction.setLoop(THREE.LoopOnce, 1);
            deathAction.clampWhenFinished = true;
            this.animations['Death'] = deathAction;
            console.log(`[Enemy ${this.id}] Death Animation Linked`);
        }
    }

    takeDamage(amount, direction) {
        if (this.isDead) return;
        this.health -= amount;
        console.log(`[Enemy ${this.id}] Took damage! HP: ${this.health}`);

        // Set red flash effect visually
        this.flashRed();

        if (this.health <= 0) {
            this.die();
        }
    }

    flashRed() {
        if (!this.modelWrapper) return;
        this.modelWrapper.traverse((child) => {
            if (child.isMesh && child.material) {
                // Save original color permanently so rapid fire doesn't overwrite it with white
                if (!child.userData.origColor) {
                    child.userData.origColor = child.material.color.getHex();
                }
                child.material.color.setHex(0xffffff); // Flash white

                // Clear any existing timeout to prevent flickering
                if (child.userData.flashTimeout) clearTimeout(child.userData.flashTimeout);

                child.userData.flashTimeout = setTimeout(() => {
                    if (child && child.material && child.userData.origColor) {
                        child.material.color.setHex(child.userData.origColor);
                    }
                }, 100);
            }
        });
    }

    die() {
        this.isDead = true;
        this.setState('DEAD'); // Use setState so it triggers animations
        console.log(`[Enemy ${this.id}] Died!`);

        // Play death audio so the player knows the enemy actually died
        if (this.deathAudio) {
            this.deathAudio.currentTime = 0;
            this.deathAudio.play().catch(e => console.log('Death audio play failed:', e));
        }

        // Remove the placeholder collision box immediately so it can't be shot anymore
        if (this.placeholder) {
            this.mesh.remove(this.placeholder);
            this.placeholder = null;
        }

        // Keep the dead body visible on the ground for 10 seconds before deleting to save memory
        setTimeout(() => {
            if (this.game && this.game.scene && this.mesh) {
                this.game.scene.remove(this.mesh);
            }
        }, 10000);
    }

    update(delta) {
        if (!this.mesh) return;

        // Animations must always run for both Host and Client
        if (this.mixer) {
            this.mixer.update(delta);
        }

        if (this.isDead) {
            // IMPORTANT FIX: The Death animation lays placing the character face-down.
            // But `modelWrapper.position.y` was shifted UP implicitly during loadModels() to fix clipping in T-Pose.
            // When prone, this upward shift causes the character to float in the air.
            // We gradually reduce the Y offset to 0.4 so the face-down body touches the true floor perfectly without vanishing.
            // This now successfully runs on BOTH Host and Client!
            if (this.modelWrapper && this.modelWrapper.position.y > 0.4) {
                this.modelWrapper.position.y = Math.max(0.4, this.modelWrapper.position.y - delta * 2.0);
            }
            return; // Halt AI logic but allow animations to play
        }

        // MULTIPLAYER SYNC: If we are a Client, simply animate the mesh at the synced network coordinates.
        // We do NOT run AI loops or collision checks on Clients, because the Host handles that and broadcasts the results.
        if (this.game.networkManager && !this.game.networkManager.isHost) {
            return;
        }

        // Logic loop
        this.updateAI(delta);

        if (this.state === 'WALK') {
            this.updateWandering(delta);
        } else if (this.state === 'CHASE') {
            this.updateChasing(delta);
        }
    }

    getClosestPlayer() {
        let minDistance = Infinity;
        let targetId = null;
        let targetPos = null;

        // Check local player
        if (this.game.player && !this.game.player.isDead) {
            const dist = this.mesh.position.distanceTo(this.game.player.getPosition());
            if (dist < minDistance && !this.game.player.isInvincible) {
                minDistance = dist;
                targetPos = this.game.player.getPosition();
                targetId = 'local';
            }
        }

        // Check remote players
        if (this.game.remotePlayers) {
            Object.values(this.game.remotePlayers).forEach(p => {
                if (!p.isDead && p.mesh) {
                    const dist = this.mesh.position.distanceTo(p.getPosition ? p.getPosition() : p.mesh.position);
                    if (dist < minDistance && !p.isInvincible) {
                        minDistance = dist;
                        targetPos = p.getPosition ? p.getPosition() : p.mesh.position;
                        targetId = p.id;
                    }
                }
            });
        }

        return { distance: minDistance, position: targetPos, id: targetId };
    }

    updateAI(delta) {
        const target = this.getClosestPlayer();

        if (target.distance === Infinity) {
            // Player is dead or missing, go back to wandering immediately from ANY state
            if (this.state !== 'WALK') {
                this.setState('WALK');
            }
            return;
        }

        if (this.state === 'WALK') {
            // Vision radius: 100.0 meters (ensures enemies from all corners immediately hunt the player)
            if (target.distance < 100.0) {
                this.setState('CHASE');
            }
        }
        else if (this.state === 'CHASE') {
            // Attack radius: 1.5 meters (Stop slightly further away before punch to avoid clipping)
            if (target.distance < 1.5) {
                this.setState('ATTACK');
                this.performMeleeAttack();
            } else if (target.distance > 20.0) {
                // Lost player
                this.setState('WALK');
            }
        }
    }

    setState(newState) {
        if (this.state === newState) return;
        this.state = newState;

        // Handle animation transitions (Only Host runs this via AI loop)
        if (this.mixer) {
            if (newState === 'WALK') {
                this.setAnimationAction('Walk');
            } else if (newState === 'CHASE') {
                // Currently Chase uses the same Walk animation
                this.setAnimationAction('Walk'); // CRITICAL: Actually set the animation so it leaves 'Attack' mode!
                if (this.animations['Walk']) {
                    this.animations['Walk'].timeScale = 1.5; // Chase slower to match new speed
                }
            } else if (newState === 'ATTACK') {
                this.setAnimationAction('Attack');
            } else if (newState === 'DEAD') {
                this.setAnimationAction('Death');
            }
        }

        // Reset time scale when leaving Chase
        if (newState !== 'CHASE' && this.animations['Walk']) {
            this.animations['Walk'].timeScale = 1.0;
        }
    }

    setAnimationAction(name) {
        if (!this.mixer || !this.animations[name]) return;
        if (this.currentAction === name) {
            // Force replay if we are re-triggering the same action (like back-to-back attacks)
            if (name === 'Attack') {
                this.animations[name].reset();
                this.animations[name].play();
            }
            return;
        }

        console.log(`[Enemy ${this.id}] Syncing animation to: ${name}`);

        // Stop current animation fully
        if (this.currentAction && this.animations[this.currentAction]) {
            this.animations[this.currentAction].fadeOut(0.1);
        }

        // Ensure new animation plays immediately with full weight
        const action = this.animations[name];
        action.reset();

        // Speed up the attack animation to make it snappy (Lowered from 1.2 to 1.1 as requested)
        if (name === 'Attack') {
            action.setEffectiveTimeScale(1.1);
        } else {
            action.setEffectiveTimeScale(1.0);
        }

        action.setEffectiveWeight(1);
        action.fadeIn(0.1);
        action.play();

        this.currentAction = name;
    }

    performMeleeAttack() {
        console.log(`[Enemy ${this.id}] Performing Melee Attack!`);

        // Wait for the animation to hit its swiping apex (faster due to timeScale=2.0)
        setTimeout(() => {
            if (this.isDead) return;

            const target = this.getClosestPlayer();

            // Check if player is still in range (needs to be close to get actually hit)
            // Increased to 1.8 to ensure hits connect from the further stopping distance
            if (target.position && target.distance < 1.8) {
                console.log(`[Enemy ${this.id}] MELEE CONNECTED! distance: ${target.distance.toFixed(1)}`);

                // Play programmatic hit sound
                this.playHitSound();

                const direction = new THREE.Vector3().subVectors(target.position, this.mesh.position).normalize();

                if (target.id === 'local') {
                    this.game.player.takeDamage(1000, direction); // Instant kill
                } else if (target.id && this.game.networkManager) {
                    this.game.networkManager.sendHit(target.id, 1000, direction);
                    if (this.game.remotePlayers[target.id]) {
                        this.game.remotePlayers[target.id].takeDamage(1000, direction);
                    }
                }
            }

            // After attack, unconditionally clear the state so the AI doesn't freeze
            // The next game tick's `updateAI` will immediately pick a new state (CHASE or WALK)
            if (!this.isDead) {
                this.state = null;
                this.setState('CHASE'); // Force transition to trigger Walk animation reset!
            }

        }, 1100); // 1100ms delay to sync with slower (1.1x) animation swing
    }

    updateChasing(delta) {
        const target = this.getClosestPlayer();
        if (!target.position) return;

        // 1. Point towards player
        const targetPos = target.position;
        const direction = new THREE.Vector3().subVectors(targetPos, this.mesh.position);
        direction.y = 0; // Keep flat on XZ plane
        direction.normalize();

        const targetYaw = Math.atan2(direction.x, direction.z);

        // Smoothly rotate towards player
        const diff = targetYaw - this.mesh.rotation.y;
        let normalizedDiff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.mesh.rotation.y += Math.sign(normalizedDiff) * Math.min(Math.abs(normalizedDiff), this.turnSpeed * 1.5 * delta);

        // 2. Move towards player (faster walk)
        const chaseSpeed = this.walkSpeed * 1.5;
        const moveVec = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
        moveVec.normalize().multiplyScalar(chaseSpeed * delta);

        const walls = this.game.level ? this.game.level.getCollidables() : [];

        // Apply Enemy-vs-Enemy Separation (anti-stacking)
        this.game.enemies.forEach(other => {
            if (other.id !== this.id && other.mesh && !other.isDead) {
                const dist = this.mesh.position.distanceTo(other.mesh.position);
                if (dist < 1.0 && dist > 0.01) {
                    const push = new THREE.Vector3().subVectors(this.mesh.position, other.mesh.position).normalize().multiplyScalar(1.5 * delta);
                    moveVec.add(push); // Divert path away from overlapping neighbor
                }
            }
        });

        // Apply X movement with Wall Collision
        const startPos = this.mesh.position.clone();
        this.mesh.position.x += moveVec.x;
        // 判定球を 0.5 -> 0.85 に拡大し、壁に深くめり込んでスタックするのを防ぐ
        const enemySphereX = new THREE.Sphere(this.mesh.position.clone(), 0.85);
        for (const wall of walls) {
            wall.geometry.computeBoundingBox();
            if (new THREE.Box3().setFromObject(wall).intersectsSphere(enemySphereX)) {
                this.mesh.position.x = startPos.x;
                break;
            }
        }

        // Apply Z movement with Wall Collision
        this.mesh.position.z += moveVec.z;
        const enemySphereZ = new THREE.Sphere(this.mesh.position.clone(), 0.85);
        for (const wall of walls) {
            wall.geometry.computeBoundingBox();
            if (new THREE.Box3().setFromObject(wall).intersectsSphere(enemySphereZ)) {
                this.mesh.position.z = startPos.z;
                break;
            }
        }

        this.mesh.position.y = 0;
    }

    updateWandering(delta) {
        // Simple Wandering Logic
        this.changeDirectionTimer -= delta;

        // 1. Move forward
        const moveVec = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
        moveVec.normalize().multiplyScalar(this.walkSpeed * delta);

        // Check collisions before applying movement
        const raycaster = new THREE.Raycaster(
            new THREE.Vector3(this.mesh.position.x, 1.0, this.mesh.position.z),
            moveVec.clone().normalize(),
            0,
            2.0 // Look 2 meters ahead
        );

        const walls = this.game.level ? this.game.level.getCollidables() : [];
        const intersects = raycaster.intersectObjects(walls);

        if (intersects.length > 0 || this.changeDirectionTimer <= 0) {
            // Hit a wall or time to turn -> Pick new random direction
            this.changeDirectionTimer = 3.0 + Math.random() * 4.0; // Walk for 3-7 seconds

            // Turn by 90-180 degrees if hit wall, otherwise random slight turn
            if (intersects.length > 0) {
                this.targetRotation = this.mesh.rotation.y + Math.PI + (Math.random() - 0.5) * Math.PI;
            } else {
                this.targetRotation = this.mesh.rotation.y + (Math.random() - 0.5) * Math.PI;
            }
        }

        // Smoothly rotate towards target
        if (this.targetRotation !== undefined) {
            // Angle interpolation
            const diff = this.targetRotation - this.mesh.rotation.y;
            // Normalize diff to -PI to PI
            let normalizedDiff = Math.atan2(Math.sin(diff), Math.cos(diff));

            this.mesh.rotation.y += Math.sign(normalizedDiff) * Math.min(Math.abs(normalizedDiff), this.turnSpeed * delta);

            if (Math.abs(normalizedDiff) < 0.1) {
                this.targetRotation = undefined;
            }
        }

        // Apply Movement with Wall Collision
        const startPos = this.mesh.position.clone();

        // Apply Enemy-vs-Enemy Separation (anti-stacking)
        this.game.enemies.forEach(other => {
            if (other.id !== this.id && other.mesh && !other.isDead) {
                const dist = this.mesh.position.distanceTo(other.mesh.position);
                if (dist < 1.0 && dist > 0.01) {
                    const push = new THREE.Vector3().subVectors(this.mesh.position, other.mesh.position).normalize().multiplyScalar(1.5 * delta);
                    moveVec.add(push);
                }
            }
        });

        // Apply X
        this.mesh.position.x += moveVec.x;
        const enemySphereX = new THREE.Sphere(this.mesh.position.clone(), 0.85);
        for (const wall of walls) {
            wall.geometry.computeBoundingBox();
            if (new THREE.Box3().setFromObject(wall).intersectsSphere(enemySphereX)) {
                this.mesh.position.x = startPos.x;
                // If we hit a wall while wandering, force a turn immediately instead of waiting
                this.changeDirectionTimer = 0;
                break;
            }
        }

        // Apply Z
        this.mesh.position.z += moveVec.z;
        const enemySphereZ = new THREE.Sphere(this.mesh.position.clone(), 0.85);
        for (const wall of walls) {
            wall.geometry.computeBoundingBox();
            if (new THREE.Box3().setFromObject(wall).intersectsSphere(enemySphereZ)) {
                this.mesh.position.z = startPos.z;
                // Force turn
                this.changeDirectionTimer = 0;
                break;
            }
        }

        // Keep height at ground
        this.mesh.position.y = 0;
    }

    playHitSound() {
        try {
            const snd = new Audio('/models/enemy/punch_robot.WAV');
            snd.volume = 0.8;
            snd.play().catch(e => console.warn(e));
        } catch (e) {
            console.warn("Audio playback failed:", e);
        }
    }
}
