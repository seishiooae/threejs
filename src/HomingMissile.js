import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export class HomingMissile {
    constructor(game, position, targetPlayer, options = {}) {
        this.game = game;
        this.targetPlayer = targetPlayer;

        this.alive = true;
        this.speed = 3.75; // Halved again per user request
        this.turnSpeed = 5.0; // Increased sharpness to track player better at lower speeds
        this.lifeTime = 5.0; // Detonates after 5 seconds if it misses
        this.damage = 25;
        this.explosionRadius = 4.0;
        this.explosionForce = 15.0; // Impulsive knockback force

        // 80% accuracy determination roll (can be overridden by volley options so all missiles hit/miss together)
        this.isAccurate = options.isAccurate !== undefined ? options.isAccurate : Math.random() < 0.8;
        this.missOffset = options.missOffset || new THREE.Vector3();
        if (!this.isAccurate && !options.missOffset) {
            // If it's the 20% that misses, it targets a random point significantly far away from the player
            this.missOffset.set(
                (Math.random() - 0.5) * 15, // X offset
                (Math.random() - 0.5) * 5,  // Y offset
                (Math.random() - 0.5) * 15  // Z offset
            );
            console.log("Missile spawned as INACCURATE (20% miss chance).");
        }

        // Visuals: Use Group as container (position/collision tracked here)
        this.mesh = new THREE.Group();
        this.mesh.position.copy(position);

        // Tiny placeholder sphere (visible until FBX loads, also serves as glow core)
        const placeholderGeom = new THREE.SphereGeometry(0.1, 6, 6);
        const placeholderMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
        this.placeholder = new THREE.Mesh(placeholderGeom, placeholderMat);
        this.mesh.add(this.placeholder);

        // Add a glow light
        this.light = new THREE.PointLight(0xff4400, 1, 10);
        this.mesh.add(this.light);

        // Asynchronously load the FBX rocket model
        this.fbxModel = null;
        const loader = new FBXLoader();
        loader.load('/models/enemy/RocketLauncherA_Ammo.FBX', (object) => {
            if (!this.alive) return; // Already exploded before model loaded
            object.scale.setScalar(0.024); // 3x larger for better visibility

            // Fix orientation: Rocket ammo FBX models often have their long axis (nose) along +X.
            // Three.js lookAt() makes the Group's +Z face the target.
            // We wrap the model in a pivot to apply a local rotation offset.
            const pivot = new THREE.Group();
            // Rotate so the model's nose (originally along +X) now points along local +Z
            pivot.rotation.set(0, -Math.PI / 2, 0); // Rotate -90° around Y axis
            pivot.add(object);
            // Also try a slight X tilt if the model is angled
            // object.rotateX(-Math.PI / 2); // Uncomment if nose still off

            object.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    // Log mesh names so we can identify which is the box/casing
                    console.log('[HomingMissile] FBX mesh:', child.name, 'vertices:', child.geometry?.attributes?.position?.count);
                    // Hide any mesh that looks like a box, case, crate, magazine, shell casing
                    const name = (child.name || '').toLowerCase();
                    if (name.includes('box') || name.includes('case') || name.includes('crate') ||
                        name.includes('magazine') || name.includes('mag') || name.includes('clip') ||
                        name.includes('shell') || name.includes('cartridge') || name.includes('casing') ||
                        name.startsWith('ucx_') || name.startsWith('ubx_') || name.startsWith('ucp_')) {
                        child.visible = false;
                        console.log('[HomingMissile] Hidden mesh (casing):', child.name);
                    }
                }
            });
            this.fbxModel = pivot;
            this.mesh.add(pivot);
            // Hide placeholder once model is ready
            this.placeholder.visible = false;
        }, undefined, (err) => {
            console.warn('[HomingMissile] Failed to load FBX model:', err);
        });

        // ── Fire / Exhaust Trail ─────────────────────────────────────────
        // Create a continuous particle trail behind the missile using three.quarks
        this._setupTrail();

        this.game.scene.add(this.mesh);

        // Initial velocity: shoot sideways parallel to the ground, so it has to curve into the player
        this.velocity = new THREE.Vector3();
        if (targetPlayer) {
            const playerPos = targetPlayer.getPosition ? targetPlayer.getPosition() : targetPlayer.mesh.position;
            const toPlayer = playerPos.clone().sub(position);
            toPlayer.y = 0; // Strictly horizontal
            toPlayer.normalize();

            // Randomly shoot 45 to 90 degrees left or right, or use the exact volley angle
            let angle;
            if (options.launchAngle !== undefined) {
                angle = options.launchAngle;
            } else {
                const sign = Math.random() > 0.5 ? 1 : -1;
                angle = sign * (Math.PI / 4 + Math.random() * Math.PI / 4);
            }
            toPlayer.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);

            this.velocity.copy(toPlayer).multiplyScalar(this.speed);
        } else {
            // Fallback
            this.velocity.set((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5);
        }

        // Audio
        this.explosionSound = new Audio('/models/enemy/game_explosion7.WAV');
        this.explosionSound.volume = 0.6;
    }

    /** Setup continuous fire trail behind the missile – big and flashy! */
    _setupTrail() {
        try {
            if (!this.game.vfx || !this.game.vfx.batchRenderer) return;

            const quarks = import('three.quarks');
            quarks.then((Q) => {
                if (!this.alive) return;

                // ── Layer 1: Large animated FIRE trail ──────────────────────
                this.trailFire = new Q.ParticleSystem({
                    duration: 10,
                    looping: true,
                    startLife: new Q.IntervalValue(0.2, 0.5),
                    startSpeed: new Q.IntervalValue(1, 4),
                    startSize: new Q.IntervalValue(0.3, 0.8),
                    startRotation: new Q.IntervalValue(-Math.PI, Math.PI),
                    startColor: new Q.ConstantColor(new THREE.Vector4(1, 1, 1, 1)),
                    worldSpace: true,
                    maxParticle: 150,
                    emissionOverTime: new Q.ConstantValue(120),
                    emissionBursts: [],
                    shape: new Q.SphereEmitter({ radius: 0.05, arc: Math.PI * 2, thickness: 1 }),
                    material: new THREE.MeshBasicMaterial({
                        map: this.game.vfx.fireGlowTex,
                        blending: THREE.AdditiveBlending,
                        transparent: true,
                        side: THREE.DoubleSide,
                        depthWrite: false,
                    }),
                    renderMode: Q.RenderMode.BillBoard,
                    renderOrder: 1,
                    autoDestroy: false,
                });
                this.trailFire.addBehavior(new Q.SizeOverLife(new Q.PiecewiseBezier([[new Q.Bezier(0.5, 1, 0.6, 0), 0]])));
                this.trailFire.addBehavior(new Q.ColorOverLife(new Q.ColorRange(
                    new THREE.Vector4(1, 0.7, 0.15, 1),
                    new THREE.Vector4(1, 0.1, 0.0, 0)
                )));
                this.trailFire.addBehavior(new Q.RotationOverLife(new Q.IntervalValue(-Math.PI / 2, Math.PI / 2)));
                this.mesh.add(this.trailFire.emitter);
                this.game.vfx.batchRenderer.addSystem(this.trailFire);

                // ── Layer 2: Hot SPARKS flying out the back ────────────────
                this.trailSparks = new Q.ParticleSystem({
                    duration: 10,
                    looping: true,
                    startLife: new Q.IntervalValue(0.1, 0.35),
                    startSpeed: new Q.IntervalValue(4, 12),
                    startSize: new Q.IntervalValue(0.05, 0.15),
                    startColor: new Q.RandomColor(
                        new THREE.Vector4(1.0, 0.9, 0.5, 1),
                        new THREE.Vector4(1.0, 0.5, 0.1, 1)
                    ),
                    worldSpace: true,
                    maxParticle: 80,
                    emissionOverTime: new Q.ConstantValue(60),
                    emissionBursts: [],
                    shape: new Q.ConeEmitter({ radius: 0.03, arc: Math.PI * 2, thickness: 1, angle: 0.3 }),
                    material: new THREE.MeshBasicMaterial({
                        map: this.game.vfx.sparkTex,
                        blending: THREE.AdditiveBlending,
                        transparent: true,
                        side: THREE.DoubleSide,
                        depthWrite: false,
                    }),
                    renderMode: Q.RenderMode.StretchedBillBoard,
                    speedFactor: 0.5,
                    renderOrder: 2,
                    autoDestroy: false,
                });
                this.trailSparks.addBehavior(new Q.SizeOverLife(new Q.PiecewiseBezier([[new Q.Bezier(1, 0.9, 0.5, 0), 0]])));
                // Rotate the sparks emitter to face backwards (opposite of flight)
                this.trailSparks.emitter.rotation.set(0, Math.PI, 0);
                this.mesh.add(this.trailSparks.emitter);
                this.game.vfx.batchRenderer.addSystem(this.trailSparks);

                // ── Layer 3: Thick SMOKE trail (very visible!) ────────────────
                this.trailSmoke = new Q.ParticleSystem({
                    duration: 10,
                    looping: true,
                    startLife: new Q.IntervalValue(0.6, 1.3),
                    startSpeed: new Q.IntervalValue(0.3, 2),
                    startSize: new Q.IntervalValue(0.5, 1.5),
                    startRotation: new Q.IntervalValue(-Math.PI, Math.PI),
                    startColor: new Q.RandomColor(
                        new THREE.Vector4(0.6, 0.6, 0.6, 0.5),
                        new THREE.Vector4(0.9, 0.9, 0.9, 0.8)
                    ),
                    worldSpace: true,
                    maxParticle: 120,
                    emissionOverTime: new Q.ConstantValue(80),
                    emissionBursts: [],
                    shape: new Q.SphereEmitter({ radius: 0.12, arc: Math.PI * 2, thickness: 1 }),
                    material: new THREE.MeshBasicMaterial({
                        map: this.game.vfx.smokeTex,
                        blending: THREE.NormalBlending,
                        transparent: true,
                        side: THREE.DoubleSide,
                        depthWrite: false,
                    }),
                    renderMode: Q.RenderMode.BillBoard,
                    renderOrder: -1,
                    autoDestroy: false,
                });
                this.trailSmoke.addBehavior(new Q.ColorOverLife(new Q.ColorRange(
                    new THREE.Vector4(1, 1, 1, 0.7),
                    new THREE.Vector4(0.5, 0.5, 0.5, 0)
                )));
                this.trailSmoke.addBehavior(new Q.SizeOverLife(new Q.PiecewiseBezier([[new Q.Bezier(0.3, 0.8, 1, 0.9), 0]])));
                this.trailSmoke.addBehavior(new Q.RotationOverLife(new Q.IntervalValue(-Math.PI / 3, Math.PI / 3)));
                this.trailSmoke.addBehavior(new Q.ApplyForce(new THREE.Vector3(0, 3, 0), new Q.ConstantValue(1)));
                this.mesh.add(this.trailSmoke.emitter);
                this.game.vfx.batchRenderer.addSystem(this.trailSmoke);

            }).catch(e => console.warn('[HomingMissile] Trail setup failed:', e));
        } catch (e) {
            console.warn('[HomingMissile] Trail setup error:', e);
        }
    }


    update(delta) {
        if (!this.alive) return;

        this.lifeTime -= delta;
        if (this.lifeTime <= 0) {
            this.explode();
            return;
        }

        // Homing Logic
        if (this.targetPlayer) {
            const playerPos = this.targetPlayer.getPosition ? this.targetPlayer.getPosition() : this.targetPlayer.mesh.position;
            // Where we want to go
            let targetPos = playerPos.clone();
            targetPos.y += 1.0; // Aim at chest height

            if (!this.isAccurate) {
                targetPos.add(this.missOffset); // intentionally miss
            }

            // Direction to target
            const desiredDirection = targetPos.clone().sub(this.mesh.position).normalize();

            // Current direction (normalized velocity)
            const currentDirection = this.velocity.clone().normalize();

            // Smoothly turn current velocity towards desired velocity using Slerp/Lerp
            currentDirection.lerp(desiredDirection, this.turnSpeed * delta).normalize();

            // Apply speed
            this.velocity.copy(currentDirection).multiplyScalar(this.speed);
        }

        // Apply movement
        const moveStep = this.velocity.clone().multiplyScalar(delta);
        this.mesh.position.add(moveStep);

        // Rotate the missile to face its travel direction
        if (this.velocity.lengthSq() > 0.01) {
            const lookTarget = this.mesh.position.clone().add(this.velocity);
            this.mesh.lookAt(lookTarget);
        }

        // Check Collisions (Primitive distance check)
        this.checkCollisions();
    }

    checkCollisions() {
        if (!this.alive) return;

        // Check Player hit
        if (this.targetPlayer && !this.targetPlayer.isDead) {
            const playerPos = this.targetPlayer.getPosition ? this.targetPlayer.getPosition() : this.targetPlayer.mesh.position;
            const dist = this.mesh.position.distanceTo(playerPos);
            if (dist < 1.5) { // Hit radius
                this.explode();
                return;
            }
        }

        // Check Floor/Wall hit (simplified constraint)
        if (this.mesh.position.y <= 0.2) {
            this.explode();
            return;
        }
    }

    explode() {
        if (!this.alive) return;
        this.alive = false;

        // Stop & cleanup all exhaust trail layers
        [this.trailFire, this.trailSparks, this.trailSmoke].forEach(sys => {
            if (sys) {
                sys.endEmit();
                sys.autoDestroy = true;
                sys.markForDestroy = true;
            }
        });

        console.log("Homing Missile detontated at", this.mesh.position);

        // VFX particle explosion (wrapped in try/catch for safety)
        try { if (this.game.vfx) this.game.vfx.explosion(this.mesh.position.clone()); } catch (e) { console.warn('VFX explosion error:', e); }

        // Play Sound
        if (this.explosionSound) {
            this.explosionSound.currentTime = 0;
            this.explosionSound.play().catch(e => console.log('Explosion sound failed:', e));
        }

        // Old orange sphere removed — three.quarks VFX explosion handles everything now

        // Calculate Damage & Knockback for local player
        if (this.targetPlayer === this.game.player && !this.targetPlayer.isDead) {
            const playerPos = this.targetPlayer.getPosition ? this.targetPlayer.getPosition() : this.targetPlayer.mesh.position;
            const dist = this.mesh.position.distanceTo(playerPos);
            if (dist <= this.explosionRadius) {
                // Direction from explosion TO player
                const knockbackDir = playerPos.clone().sub(this.mesh.position).normalize();
                // Add vertical lift to the explosion so they fly upwards slightly
                knockbackDir.y += 0.5;
                knockbackDir.normalize();

                // Tell player to take damage, pass in knockback direction for physics
                this.targetPlayer.takeDamage(this.damage, knockbackDir, this.explosionForce);
            }
        }

        // Cleanup
        this.game.scene.remove(this.mesh);
    }
}
