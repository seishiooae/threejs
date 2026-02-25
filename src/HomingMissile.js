import * as THREE from 'three';

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

        // Visuals (Halved size)
        const geometry = new THREE.SphereGeometry(0.15, 8, 8);
        const material = new THREE.MeshBasicMaterial({ color: 0xff4400 });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);

        // Add a trail or glow (simple point light)
        this.light = new THREE.PointLight(0xff4400, 1, 10);
        this.mesh.add(this.light);

        this.game.scene.add(this.mesh);

        // Initial velocity: shoot sideways parallel to the ground, so it has to curve into the player
        this.velocity = new THREE.Vector3();
        if (targetPlayer && targetPlayer.mesh) {
            const toPlayer = targetPlayer.mesh.position.clone().sub(position);
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

    update(delta) {
        if (!this.alive) return;

        this.lifeTime -= delta;
        if (this.lifeTime <= 0) {
            this.explode();
            return;
        }

        // Homing Logic
        if (this.targetPlayer && this.targetPlayer.mesh) {
            // Where we want to go
            let targetPos = this.targetPlayer.mesh.position.clone();
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

        // Check Collisions (Primitive distance check)
        this.checkCollisions();
    }

    checkCollisions() {
        if (!this.alive) return;

        // Check Player hit
        if (this.targetPlayer && this.targetPlayer.mesh && !this.targetPlayer.isDead) {
            const dist = this.mesh.position.distanceTo(this.targetPlayer.mesh.position);
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

        console.log("Homing Missile detontated at", this.mesh.position);

        // Play Sound
        if (this.explosionSound) {
            this.explosionSound.currentTime = 0;
            this.explosionSound.play().catch(e => console.log('Explosion sound failed:', e));
        }

        // Create visual effect
        this.game.createHitEffect(this.mesh.position, new THREE.Vector3(0, 1, 0), 0xffaa00);
        // Larger explosion effect
        const explosionGeom = new THREE.SphereGeometry(this.explosionRadius, 16, 16);
        const explosionMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 });
        const explosionMesh = new THREE.Mesh(explosionGeom, explosionMat);
        explosionMesh.position.copy(this.mesh.position);
        this.game.scene.add(explosionMesh);

        // Animate explosion fading
        let scale = 1;
        const fadeInterval = setInterval(() => {
            scale += 0.2;
            explosionMesh.scale.setScalar(scale);
            explosionMat.opacity -= 0.1;
            if (explosionMat.opacity <= 0) {
                clearInterval(fadeInterval);
                this.game.scene.remove(explosionMesh);
            }
        }, 30);

        // Calculate Damage & Knockback for local player
        if (this.targetPlayer === this.game.player && !this.targetPlayer.isDead) {
            const dist = this.mesh.position.distanceTo(this.targetPlayer.mesh.position);
            if (dist <= this.explosionRadius) {
                // Direction from explosion TO player
                const knockbackDir = this.targetPlayer.mesh.position.clone().sub(this.mesh.position).normalize();
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
