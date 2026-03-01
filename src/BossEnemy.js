import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HomingMissile } from './HomingMissile.js';

export class BossEnemy {
    constructor(game, position, id, assets) {
        this.game = game;
        this.id = id;
        this.assets = assets;

        // --- State Machine ---
        // 'PATROL', 'ALERT', 'LIGHTNING_ATTACK', 'DEAD'
        this.state = 'PATROL';
        this.timeInState = 0;

        // Combat Stats (Buffed to withstand more Assault Rifle fire, but reduced from 1000 to 400 per user request)
        this.maxHealth = 2000;
        this.health = this.maxHealth;
        this.isDead = false;

        // Constants configurable for Boss
        this.ALERT_RANGE = 18.0;     // Much further sight
        this.ATTACK_RANGE = 12.0;    // Range to trigger lightning
        this.WALK_SPEED = 2.0;       // Slow patrol walk
        this.CHASE_SPEED = 4.0;      // Faster when alert (though mostly attacks)
        this.TURN_SPEED = 3.0;

        // Individual Random AI Characteristics
        this.speedVariability = 0.8 + Math.random() * 0.4; // 0.8x to 1.2x base speed
        this.strafePhase = Math.random() * Math.PI * 2; // Random starting sine phase
        this.strafeSpeed = 1.0 + Math.random() * 2.0; // How fast they strafe cycle
        this.strafeMagnitude = 0.4 + Math.random() * 0.6; // Max radians to deviate from exact player trajectory
        this.chaseTimer = 0;
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
        // this.walkSpeed = 0.60; // Replaced by this.WALK_SPEED
        // this.turnSpeed = 1.5; // Replaced by this.TURN_SPEED

        // Add a placeholder box until FBX loads
        this.createPlaceholder();

        this.loadModels();

        // Used for wandering
        this.wanderDirection = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
        this.changeDirectionTimer = 0;

        // Boss specific
        this.lightningCooldown = 0; // Cooldown for lightning attack
        // Setup initial waypoints relative to spawn position (a square around the treasure)
        this.waypoints = [
            new THREE.Vector3(position.x - 12, 0, position.z - 12),
            new THREE.Vector3(position.x + 12, 0, position.z - 12),
            new THREE.Vector3(position.x + 12, 0, position.z + 12),
            new THREE.Vector3(position.x - 12, 0, position.z + 12)
        ];
        this.currentWaypointIndex = 0;

        // Audio
        this.hitAudio = new Audio('/models/enemy/punch_robot.WAV');
        this.deathAudio = new Audio('/models/enemy/devil_scared2.WAV');

        // Health bar (shown on first damage, DOM overlay in top-right)
        this.healthBarVisible = false;
    }

    createPlaceholder() {
        // Red box placeholder
        const geometry = new THREE.CylinderGeometry(1.2, 1.2, 5.4, 8); // 3x size
        const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        this.placeholder = new THREE.Mesh(geometry, material);
        this.placeholder.position.y = 2.7; // Half height
        this.placeholder.castShadow = true;
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

        // Boss should be 3x the physical size of standard enemies (0.000185)
        const scale = 0.000185 * 3; // Giant Boss Scale
        object.scale.set(scale, scale, scale);

        // Setup hierarchy for Z-up to Y-up rotation
        this.modelWrapper = new THREE.Group();
        this.modelWrapper.rotation.x = -Math.PI / 2;
        this.modelWrapper.add(object);

        // Auto-center feet to Ground
        this.modelWrapper.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(this.modelWrapper);
        // We add the absolute value of the lowest point to shift the model up so feet sit on Y=0.
        // The Boss 3D model's hands hang lower than its feet in T-pose, so we subtract 0.5 to keep the feet planted.
        if (box.min.y < 0) {
            this.modelWrapper.position.y = Math.abs(box.min.y) - 0.5;
        } else {
            this.modelWrapper.position.y = -0.5;
        }

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

        // 4. Roar Animation
        if (this.assets.animations['Roar']) {
            const roarAction = this.mixer.clipAction(this.assets.animations['Roar']);
            roarAction.setLoop(THREE.LoopOnce, 1);
            roarAction.clampWhenFinished = true;
            this.animations['Roar'] = roarAction;
            console.log(`[Enemy ${this.id}] Roar Animation Linked`);
        }
    }

    takeDamage(amount, direction, shooterId = null) {
        if (this.isDead) return;
        this.health -= amount;
        console.log(`[Enemy ${this.id}] Took damage! HP: ${this.health}`);

        // Set red flash effect visually
        this.flashRed();

        // Play hurt voice
        try {
            const hurtSound = new Audio('/models/enemy/devil_scared2.WAV');
            hurtSound.volume = 0.5;
            hurtSound.play().catch(e => console.log('Hurt sound failed:', e));
        } catch (e) { /* ignore */ }

        // Show & update health bar
        this._showHealthBar();

        if (this.health <= 0) {
            this.die();
        } else {
            // Note: Removed the homing missile revenge code since Boss attacks with Lightning
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

        // Remove health bar
        this._removeHealthBar();

        // Keep the dead body visible on the ground for 10 seconds before deleting to save memory
        setTimeout(() => {
            if (this.game && this.game.scene && this.mesh) {
                this.game.scene.remove(this.mesh);
            }
        }, 10000);
    }

    update(delta) {
        if (!this.mesh) return;

        // Fade out health bar after duration
        this._updateHealthBarVisibility(delta);

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
        if (this.state === 'DEAD') return;

        this.timeInState += delta;

        if (this.lightningCooldown > 0) {
            this.lightningCooldown -= delta;
        }

        const target = this.getClosestPlayer();

        switch (this.state) {
            case 'PATROL':
                this.updatePatrol(delta);
                // Only alert if we can actually attack (cooldown ready)
                if (target.distance < this.ALERT_RANGE && this.lightningCooldown <= 0) {
                    this.setState('ALERT');
                }
                break;
            case 'ALERT':
                this.updateAlert(delta);
                // Wait for roar animation to finish (approx 2s) before striking
                if (this.timeInState > 2.0) {
                    if (target.distance < this.ATTACK_RANGE * 1.5) { // generous forgiveness range
                        this.setState('LIGHTNING_ATTACK');
                    } else {
                        // Player ran away out of sight
                        this.setState('PATROL');
                    }
                }
                break;
            case 'LIGHTNING_ATTACK':
                this.updateLightningAttack(delta);
                // Transition out of attack state after strike finishes
                if (this.timeInState > 2.5) {
                    this.lightningCooldown = 3.0 + Math.random() * 2.0; // 3-5 second cooldown
                    this.hasTargetedLightning = false; // Reset for next attack
                    this.setState('PATROL'); // Always return to patrol to avoid freezing
                }
                break;
        }
    }

    setState(newState) {
        if (this.state === newState) return;
        this.state = newState;
        this.timeInState = 0; // Reset time in state

        if (newState === 'LIGHTNING_ATTACK') {
            this.hasTargetedLightning = false;
        }

        // Handle animation transitions (Only Host runs this via AI loop)
        if (this.mixer) {
            if (newState === 'PATROL') {
                this.setAnimationAction('Walk');
                if (this.animations['Walk']) {
                    this.animations['Walk'].timeScale = 1.0; // Patrol speed
                }
            } else if (newState === 'ALERT') {
                this.setAnimationAction('Roar'); // Play roar when alerting
                try {
                    const roarSnd = new Audio('/models/enemy/roar.WAV');
                    roarSnd.volume = 0.9;
                    roarSnd.play().catch(e => console.warn(e));
                } catch (e) { }
            } else if (newState === 'LIGHTNING_ATTACK') {
                this.setAnimationAction('Roar'); // Boss roars during lightning attack, not punch
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


    updatePatrol(delta) {
        const targetPos = this.waypoints[this.currentWaypointIndex];
        const dist = this.mesh.position.distanceTo(targetPos);

        if (dist < 1.0) {
            // Reached waypoint, go to next
            this.currentWaypointIndex = (this.currentWaypointIndex + 1) % this.waypoints.length;
        }

        // Rotate towards waypoint
        const direction = new THREE.Vector3().subVectors(targetPos, this.mesh.position);
        direction.y = 0;
        direction.normalize();

        const targetYaw = Math.atan2(direction.x, direction.z);
        const diff = targetYaw - this.mesh.rotation.y;
        let normalizedDiff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.mesh.rotation.y += Math.sign(normalizedDiff) * Math.min(Math.abs(normalizedDiff), this.TURN_SPEED * delta);

        // Move forward if mostly facing target
        if (Math.abs(normalizedDiff) < 0.5) {
            const moveVec = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
            moveVec.normalize().multiplyScalar(this.WALK_SPEED * delta);

            // Assume waypoints are safe from wall clipping to avoid Level checkCollision TypeError
            this.mesh.position.add(moveVec);
        }
    }

    updateAlert(delta) {
        // Find player to face them while roaring
        const target = this.getClosestPlayer();
        if (target.position) {
            const direction = new THREE.Vector3().subVectors(target.position, this.mesh.position);
            direction.y = 0;
            const targetYaw = Math.atan2(direction.x, direction.z);
            const diff = targetYaw - this.mesh.rotation.y;
            let normalizedDiff = Math.atan2(Math.sin(diff), Math.cos(diff));
            this.mesh.rotation.y += Math.sign(normalizedDiff) * Math.min(Math.abs(normalizedDiff), this.TURN_SPEED * delta);
        }

        // Note: State transition to LIGHTNING_ATTACK is handled cleanly in updateAI() 
        // to prevent the boss from freezing in the ALERT state loop forever.
    }

    updateLightningAttack(delta) {
        // At the very start of the attack, spawn the warning circle
        if (!this.hasTargetedLightning) {
            this.hasTargetedLightning = true;

            const target = this.getClosestPlayer();
            if (target.position && this.game.vfx) {
                const strikeTarget = target.position.clone();

                // Broadcast lightning position to all Clients so they can spawn VFX too
                if (this.game.networkManager) {
                    this.game.networkManager.sendLightningStrike(strikeTarget);
                }

                // Strike at player's current position (Host sees VFX locally)
                this.game.vfx.spawnLightning(strikeTarget, (strikePos) => {
                    // This callback fires when the lightning actually hits
                    // Check if HOST's local player is within blast radius (e.g., 3 meters)
                    const playerPos = this.game.player.getPosition();
                    const distToStrike = playerPos.distanceTo(strikePos);
                    if (distToStrike < 3.0) {
                        if (this.game.player.takeLightningStrike) {
                            this.game.player.takeLightningStrike();
                        } else {
                            this.game.player.takeDamage(50, new THREE.Vector3(0, 0, 0));
                        }
                    }
                });
            }
        }

        // We handle the return to PATROL cleanly in updateAI(), so we don't repeat it here.
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

    // 隨渉隨渉 Health Bar (DOM overlay in top-right) 隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉隨渉

    /** Get the index of this enemy in game.enemies array */
    _getEnemyIndex() {
        if (!this.game || !this.game.enemies) return -1;
        return this.game.enemies.indexOf(this);
    }

    _showHealthBar() {
        const idx = this._getEnemyIndex();
        if (idx < 0) return;
        const el = document.getElementById(`enemy-hp-${idx}`);
        if (!el) return;

        const pct = Math.max(0, (this.health / this.maxHealth) * 100);

        el.style.display = 'block';
        const fill = el.querySelector('.enemy-hp-fill');
        const text = el.querySelector('.enemy-hp-text');

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
            text.textContent = Math.round(pct) + '%';
        }

        this.healthBarVisible = true;
    }

    _removeHealthBar() {
        const idx = this._getEnemyIndex();
        if (idx < 0) return;
        const el = document.getElementById(`enemy-hp-${idx}`);
        if (el) el.style.display = 'none';
        this.healthBarVisible = false;
    }

    _updateHealthBarVisibility(delta) {
        // Health bars stay visible once shown (removed auto-hide)
    }
}
