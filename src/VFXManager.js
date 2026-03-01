import * as THREE from 'three';
import {
    BatchedParticleRenderer,
    ParticleSystem,
    SphereEmitter,
    ConeEmitter,
    PointEmitter,
    ConstantValue,
    ConstantColor,
    IntervalValue,
    RandomColor,
    ColorRange,
    RenderMode,
    SizeOverLife,
    ColorOverLife,
    FrameOverLife,
    RotationOverLife,
    PiecewiseBezier,
    Bezier,
    ApplyForce,
} from 'three.quarks';
import { createFireGlowTexture, createSmokeTexture, createSparkTexture } from './VFXTextures.js';

/**
 * VFXManager  ERealistic fire/smoke/spark particle effects.
 * Uses procedural glow textures for photorealistic flames + sprite sheet for flash effects.
 * Call .update(delta) every frame.
 */
export class VFXManager {
    constructor(scene) {
        this.scene = scene;
        this.batchRenderer = new BatchedParticleRenderer();
        scene.add(this.batchRenderer);
        this._systems = [];
        this.texture = null;
        this._ready = false;

        // Active lightning effects (custom volumetric lightning)
        this.activeLightning = [];
        this.activeWarnings = [];

        // Lightning Flash Light (reusable point light)
        this.flashLight = new THREE.PointLight(0x88aaff, 0, 100);
        this.flashLight.position.set(0, 15, 0);
        this.scene.add(this.flashLight);

        // Lightning Audio
        try {
            this.thunderAudio = new Audio('/models/enemy/LightStrike.WAV');
            this.thunderAudio.volume = 0.8;
        } catch (e) { console.warn("Could not load thunder audio", e); }

        // Procedural textures (available immediately  Eno async loading!)
        this.fireGlowTex = createFireGlowTexture(128);
        this.smokeTex = createSmokeTexture(128);
        this.sparkTex = createSparkTexture(64);

        // Also load texture atlas for muzzle flash / frame animations
        const loader = new THREE.TextureLoader();
        loader.load('/textures/texture1.png', (tex) => {
            this.texture = tex;
            this._ready = true;
            console.log('[VFX] Texture atlas loaded');
        }, undefined, (err) => {
            console.warn('[VFX] Texture atlas failed to load, using procedural only');
            this._ready = true;
        });
    }

    // ── Public API ───────────────────────────────────────────────────────

    /** Multi-layered muzzle flash (beam + flash + sparks + smoke) */
    muzzleFlash(worldPos) {
        if (!this._ready) return;
        this._createMuzzleFlashGroup(worldPos);
    }

    /** Spawns a warning circle at pos, and calls onHitCallback after 1 second when the lightning strikes */
    spawnLightning(pos, onHitCallback) {
        const warning = new WarningCircle(this.scene);
        this.activeWarnings.push(warning);

        warning.show(pos, (strikePos) => {
            // Remove warning from active list
            this.activeWarnings = this.activeWarnings.filter(w => w !== warning);

            // Strike!
            const bolt = new LightningBolt(this.scene, this.flashLight);
            this.activeLightning.push(bolt);
            bolt.strike(strikePos);

            // Play sound
            if (this.thunderAudio) {
                this.thunderAudio.currentTime = 0;
                this.thunderAudio.play().catch(e => console.warn(e));
            }

            // Screen flash (assumes Game.js or UI overlay handles this via ID)
            const flash = document.getElementById('flash-overlay');
            if (flash) {
                flash.style.opacity = '0.8';
                setTimeout(() => flash.style.transition = 'opacity 0.3s', 50);
                setTimeout(() => flash.style.opacity = '0', 80);
                setTimeout(() => flash.style.transition = 'opacity 0.05s', 400);
            }

            // Trigger hit callback (tells Boss/Game to damage player)
            if (onHitCallback) onHitCallback(strikePos);
        });
    }

    /** Orange propellant blast when missile launches */
    missileLaunch(worldPos) {
        if (!this._ready) return;
        this._createMissileLaunchGroup(worldPos);
    }

    /** Large fireball explosion with rising flames and smoke */
    explosion(worldPos) {
        if (!this._ready) return;
        this._createExplosionGroup(worldPos);
    }

    /** Continuous Fire Effect for FireBases */
    continuousFire(worldPos) {
        if (!this._ready) {
            setTimeout(() => this.continuousFire(worldPos), 500);
            return;
        }

        // Looping fire column - Tighter base, faster rise for more realism
        const risingFlame = new ParticleSystem({
            duration: 1.0, looping: true, // LOOPING is true
            startLife: new IntervalValue(0.6, 1.2),
            startSpeed: new IntervalValue(2, 5),
            startSize: new IntervalValue(1.0, 2.5),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new ConstantColor(new THREE.Vector4(1, 0.8, 0.3, 1)),
            worldSpace: true, maxParticle: 60,
            emissionOverTime: new ConstantValue(40), // Continuous emission rate
            emissionBursts: [],
            // Use PointEmitter so particles don't spawn outward, and rise straight up
            shape: new PointEmitter(),
            material: this._makeFireMat(),
            renderMode: RenderMode.BillBoard, renderOrder: 2, autoDestroy: false,
        });
        risingFlame.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 0.6, 0.1, 1), new THREE.Vector4(0.8, 0.1, 0.0, 0))));
        risingFlame.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.2, 0.8, 1.0, 0.3), 0]])));
        risingFlame.addBehavior(new RotationOverLife(new IntervalValue(-Math.PI / 3, Math.PI / 3)));
        risingFlame.addBehavior(new ApplyForce(new THREE.Vector3(0, 12, 0), new ConstantValue(1)));
        this._addSystem(risingFlame, worldPos);

        // Looping Smoke
        const smoke = new ParticleSystem({
            duration: 2.0, looping: true,
            startLife: new IntervalValue(1.5, 2.5),
            startSpeed: new IntervalValue(1.0, 3.0),
            startSize: new IntervalValue(1.5, 3.0),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new RandomColor(new THREE.Vector4(0.5, 0.5, 0.5, 0.5), new THREE.Vector4(0.8, 0.8, 0.8, 0.6)),
            worldSpace: true, maxParticle: 30,
            emissionOverTime: new ConstantValue(12),
            emissionBursts: [],
            // Point emitter for straight up pillar of smoke
            shape: new PointEmitter(),
            material: this._makeSmokeMat(),
            renderMode: RenderMode.BillBoard, renderOrder: -1, autoDestroy: false,
        });
        smoke.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(0.7, 0.7, 0.7, 0.5), new THREE.Vector4(0.3, 0.3, 0.3, 0))));
        smoke.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.3, 0.7, 1.2, 1.0), 0]])));
        smoke.addBehavior(new RotationOverLife(new IntervalValue(-Math.PI / 4, Math.PI / 4)));
        smoke.addBehavior(new ApplyForce(new THREE.Vector3(0, 6, 0), new ConstantValue(1)));
        this._addSystem(smoke, worldPos);
    }

    /** Continuous Lightning arcing outward from Treasure */
    continuousTreasureLightning(centerPos) {
        if (!this._ready) {
            setTimeout(() => this.continuousTreasureLightning(centerPos), 500);
            return;
        }

        // Function that repeatedly strikes outward from the treasure
        const spawnArc = () => {
            if (!this.scene) return;

            // Random target point around the treasure
            const angle = Math.random() * Math.PI * 2;
            const radius = 0.3 + Math.random() * 0.5; // Branches out 0.3 - 0.8 units (sub-1 meter)
            const targetPos = new THREE.Vector3(
                centerPos.x + Math.cos(angle) * radius,
                centerPos.y - 0.5 + Math.random(), // Closer to vertical center
                centerPos.z + Math.sin(angle) * radius
            );

            // Create a fast, thin, purely visual bolt
            const bolt = new LightningBolt(this.scene, null); // No flashlight

            this.activeLightning.push(bolt);

            // Strike from treasure to the generated target point
            bolt.strike(targetPos, centerPos);

            // Shorter life span for rapid bolts
            bolt.maxLifetime = 0.15 + (Math.random() * 0.1);

            // Schedule the next bolt randomly between 50ms and 500ms
            setTimeout(spawnArc, 50 + Math.random() * 450);
        };

        // Start 3 independent arcing processes to ensure lots of lightning
        spawnArc();
        setTimeout(spawnArc, 100);
        setTimeout(spawnArc, 200);
    }

    /** Call every frame */
    update(delta) {
        this.batchRenderer.update(delta);

        for (let i = this._systems.length - 1; i >= 0; i--) {
            const sys = this._systems[i];
            if (sys.emitEnded && sys.particleNum === 0) {
                sys.dispose();
                this._systems.splice(i, 1);
            }
        }

        // Update lightning effects
        for (let i = this.activeLightning.length - 1; i >= 0; i--) {
            const bolt = this.activeLightning[i];
            bolt.update(delta);
            if (!bolt.active) {
                this.activeLightning.splice(i, 1);
            }
        }

        // Update warning circles
        for (let i = this.activeWarnings.length - 1; i >= 0; i--) {
            this.activeWarnings[i].update(delta);
        }
    }

    // ── Internal helpers ─────────────────────────────────────────────────

    _addSystem(sys, worldPos) {
        sys.emitter.position.set(worldPos.x, worldPos.y, worldPos.z);
        this.scene.add(sys.emitter);
        this.batchRenderer.addSystem(sys);
        this._systems.push(sys);
    }

    /** Sprite sheet material (for muzzle flash / frame animations) */
    _makeMat(blending = THREE.AdditiveBlending) {
        return new THREE.MeshBasicMaterial({
            map: this.texture,
            blending, transparent: true, side: THREE.DoubleSide, depthWrite: false,
        });
    }

    /** Soft fire glow material (procedural) */
    _makeFireMat() {
        return new THREE.MeshBasicMaterial({
            map: this.fireGlowTex,
            blending: THREE.AdditiveBlending,
            transparent: true, side: THREE.DoubleSide, depthWrite: false,
        });
    }

    /** Soft smoke material (procedural, normal blending) */
    _makeSmokeMat() {
        return new THREE.MeshBasicMaterial({
            map: this.smokeTex,
            blending: THREE.NormalBlending,
            transparent: true, side: THREE.DoubleSide, depthWrite: false,
        });
    }

    /** Bright spark material (procedural) */
    _makeSparkMat() {
        return new THREE.MeshBasicMaterial({
            map: this.sparkTex,
            blending: THREE.AdditiveBlending,
            transparent: true, side: THREE.DoubleSide, depthWrite: false,
        });
    }

    // ══════════════════════════════════════════════════════════════════╁E
    //  MUZZLE FLASH  (matching demo.quarks.art/vanilla.html)
    // ══════════════════════════════════════════════════════════════════╁E

    _createMuzzleFlashGroup(worldPos) {
        // Layer 1: Central beam glow
        const beam = new ParticleSystem({
            duration: 1,
            looping: false,
            startLife: new IntervalValue(0.1, 0.2),
            startSpeed: new ConstantValue(0),
            startSize: new ConstantValue(4),
            startColor: new ConstantColor(new THREE.Vector4(1, 0.586, 0.169, 1)),
            worldSpace: false,
            maxParticle: 10,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(1), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new PointEmitter(),
            material: this._makeMat(),
            startTileIndex: new ConstantValue(1),
            uTileCount: 10,
            vTileCount: 10,
            renderOrder: 0,
            autoDestroy: true,
        });
        beam.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.95, 0.75, 0), 0]])));
        this._addSystem(beam, worldPos);

        // Layer 2: Animated muzzle flash sprite
        const flash = new ParticleSystem({
            duration: 1,
            looping: false,
            startLife: new IntervalValue(0.1, 0.2),
            startSpeed: new ConstantValue(0),
            startSize: new IntervalValue(1, 2.5),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new ConstantColor(new THREE.Vector4(1, 1, 1, 1)),
            worldSpace: false,
            maxParticle: 5,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(2), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new PointEmitter(),
            material: this._makeMat(),
            startTileIndex: new ConstantValue(81),
            uTileCount: 10,
            vTileCount: 10,
            renderMode: RenderMode.BillBoard,
            renderOrder: 2,
            autoDestroy: true,
        });
        flash.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 0.95, 0.82, 1), new THREE.Vector4(1, 0.38, 0.12, 1))));
        flash.addBehavior(new FrameOverLife(new PiecewiseBezier([[new Bezier(81, 84.333, 87.666, 91), 0]])));
        this._addSystem(flash, worldPos);

        // Layer 3: Hot sparks (stretched billboard  Estreak effect)
        const sparks = new ParticleSystem({
            duration: 1,
            looping: false,
            startLife: new IntervalValue(0.2, 0.6),
            startSpeed: new IntervalValue(1, 15),
            startSize: new IntervalValue(0.1, 0.3),
            startColor: new RandomColor(new THREE.Vector4(1, 0.91, 0.51, 1), new THREE.Vector4(1, 0.44, 0.16, 1)),
            worldSpace: true,
            maxParticle: 10,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(8), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new ConeEmitter({ angle: 20 * Math.PI / 180, radius: 0.3, thickness: 1, arc: Math.PI * 2 }),
            material: this._makeMat(),
            startTileIndex: new ConstantValue(0),
            uTileCount: 10,
            vTileCount: 10,
            renderMode: RenderMode.StretchedBillBoard,
            speedFactor: 0.4,
            renderOrder: 1,
            autoDestroy: true,
        });
        sparks.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.95, 0.75, 0), 0]])));
        this._addSystem(sparks, worldPos);
    }

    // ══════════════════════════════════════════════════════════════════╁E
    //  MISSILE LAUNCH  Eprocedural fire textures
    // ══════════════════════════════════════════════════════════════════╁E

    _createMissileLaunchGroup(worldPos) {
        // Layer 1: Bright flash core (procedural fire glow)
        const flash = new ParticleSystem({
            duration: 0.5, looping: false,
            startLife: new IntervalValue(0.1, 0.25),
            startSpeed: new ConstantValue(0),
            startSize: new IntervalValue(2, 4),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new ConstantColor(new THREE.Vector4(1, 0.9, 0.6, 1)),
            worldSpace: false, maxParticle: 5,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(2), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new PointEmitter(),
            material: this._makeFireMat(),
            renderMode: RenderMode.BillBoard, renderOrder: 2, autoDestroy: true,
        });
        flash.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 0.9, 0.5, 1), new THREE.Vector4(1, 0.2, 0.0, 0))));
        flash.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.95, 0.75, 0), 0]])));
        this._addSystem(flash, worldPos);

        // Layer 2: Embers (spark texture)
        const embers = new ParticleSystem({
            duration: 0.5, looping: false,
            startLife: new IntervalValue(0.3, 0.6),
            startSpeed: new IntervalValue(2, 8),
            startSize: new IntervalValue(0.15, 0.35),
            startColor: new RandomColor(new THREE.Vector4(1, 0.8, 0.3, 1), new THREE.Vector4(1, 0.5, 0.1, 1)),
            worldSpace: true, maxParticle: 20,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(12), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new SphereEmitter({ radius: 0.15, arc: Math.PI * 2, thickness: 1 }),
            material: this._makeSparkMat(),
            renderMode: RenderMode.StretchedBillBoard, speedFactor: 0.3, renderOrder: 1, autoDestroy: true,
        });
        embers.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.95, 0.75, 0), 0]])));
        embers.addBehavior(new ApplyForce(new THREE.Vector3(0, 3, 0), new ConstantValue(1)));
        this._addSystem(embers, worldPos);

        // Layer 3: Smoke puff (procedural smoke)
        const smoke = new ParticleSystem({
            duration: 1.5, looping: false,
            startLife: new IntervalValue(0.5, 1.0),
            startSpeed: new IntervalValue(0.2, 2),
            startSize: new IntervalValue(0.8, 1.8),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new RandomColor(new THREE.Vector4(0.7, 0.7, 0.7, 0.4), new THREE.Vector4(1, 1, 1, 0.6)),
            worldSpace: true, maxParticle: 10,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(5), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new SphereEmitter({ radius: 0.2, arc: Math.PI * 2, thickness: 1 }),
            material: this._makeSmokeMat(),
            renderMode: RenderMode.BillBoard, renderOrder: -2, autoDestroy: true,
        });
        smoke.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 1, 1, 0.6), new THREE.Vector4(0.5, 0.5, 0.5, 0))));
        smoke.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.4, 0.8, 1, 0.9), 0]])));
        smoke.addBehavior(new RotationOverLife(new IntervalValue(-Math.PI / 4, Math.PI / 4)));
        smoke.addBehavior(new ApplyForce(new THREE.Vector3(0, 3, 0), new ConstantValue(1)));
        this._addSystem(smoke, worldPos);
    }

    // ══════════════════════════════════════════════════════════════════╁E
    //  EXPLOSION  Erealistic fireball with rising flames + smoke
    // ══════════════════════════════════════════════════════════════════╁E

    _createExplosionGroup(worldPos) {
        // Layer 1: White-hot core flash (fire glow  Ebrightest center)
        const core = new ParticleSystem({
            duration: 0.5, looping: false,
            startLife: new IntervalValue(0.15, 0.4),
            startSpeed: new ConstantValue(0),
            startSize: new IntervalValue(5, 10),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new ConstantColor(new THREE.Vector4(1, 1, 0.9, 1)),
            worldSpace: true, maxParticle: 5,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(3), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new PointEmitter(),
            material: this._makeFireMat(),
            renderMode: RenderMode.BillBoard, renderOrder: 5, autoDestroy: true,
        });
        core.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.2, 1, 0.75, 0), 0]])));
        core.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 1, 0.9, 1), new THREE.Vector4(1, 0.4, 0.0, 0))));
        this._addSystem(core, worldPos);

        // Layer 2: Fireball burst (fire glow particles flying outward)
        const fireball = new ParticleSystem({
            duration: 0.6, looping: false,
            startLife: new IntervalValue(0.3, 0.7),
            startSpeed: new IntervalValue(3, 12),
            startSize: new IntervalValue(2, 5),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new ConstantColor(new THREE.Vector4(1, 0.85, 0.4, 1)),
            worldSpace: true, maxParticle: 35,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(25), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new SphereEmitter({ radius: 0.5, arc: Math.PI * 2, thickness: 1 }),
            material: this._makeFireMat(),
            renderMode: RenderMode.BillBoard, renderOrder: 3, autoDestroy: true,
        });
        fireball.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 0.7, 0.15, 1), new THREE.Vector4(0.8, 0.1, 0.0, 0))));
        fireball.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.4, 1, 0.8, 0.1), 0]])));
        this._addSystem(fireball, worldPos);

        // Layer 3: RISING FLAME COLUMN  E4-stage staggered bursts for sustained fire
        const risingFlame = new ParticleSystem({
            duration: 1.2, looping: false,
            startLife: new IntervalValue(0.5, 1.4),
            startSpeed: new IntervalValue(1, 4),
            startSize: new IntervalValue(2, 5),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new ConstantColor(new THREE.Vector4(1, 0.7, 0.2, 1)),
            worldSpace: true, maxParticle: 30,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [
                { time: 0, count: new ConstantValue(10), cycle: 1, interval: 0.01, probability: 1 },
                { time: 0.1, count: new ConstantValue(8), cycle: 1, interval: 0.01, probability: 1 },
                { time: 0.25, count: new ConstantValue(6), cycle: 1, interval: 0.01, probability: 1 },
                { time: 0.4, count: new ConstantValue(4), cycle: 1, interval: 0.01, probability: 1 },
            ],
            shape: new SphereEmitter({ radius: 0.6, arc: Math.PI * 2, thickness: 1 }),
            material: this._makeFireMat(),
            renderMode: RenderMode.BillBoard, renderOrder: 2, autoDestroy: true,
        });
        risingFlame.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 0.5, 0.05, 1), new THREE.Vector4(0.6, 0.05, 0.0, 0))));
        risingFlame.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.3, 0.6, 1, 0.4), 0]])));
        risingFlame.addBehavior(new RotationOverLife(new IntervalValue(-Math.PI / 3, Math.PI / 3)));
        risingFlame.addBehavior(new ApplyForce(new THREE.Vector3(0, 14, 0), new ConstantValue(1)));
        this._addSystem(risingFlame, worldPos);

        // Layer 4: Hot debris sparks (spark texture  Esharp streaks)
        const debris = new ParticleSystem({
            duration: 0.5, looping: false,
            startLife: new IntervalValue(0.3, 1.0),
            startSpeed: new IntervalValue(8, 28),
            startSize: new IntervalValue(0.15, 0.5),
            startColor: new RandomColor(new THREE.Vector4(1, 0.95, 0.6, 1), new THREE.Vector4(1, 0.5, 0.15, 1)),
            worldSpace: true, maxParticle: 50,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(35), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new SphereEmitter({ radius: 0.3, arc: Math.PI * 2, thickness: 1 }),
            material: this._makeSparkMat(),
            renderMode: RenderMode.StretchedBillBoard, speedFactor: 0.5, renderOrder: 1, autoDestroy: true,
        });
        debris.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.9, 0.5, 0), 0]])));
        debris.addBehavior(new ApplyForce(new THREE.Vector3(0, -6, 0), new ConstantValue(1)));
        this._addSystem(debris, worldPos);

        // Layer 5: Thick dark smoke (procedural smoke  Eorganic rising cloud)
        const smoke = new ParticleSystem({
            duration: 3.0, looping: false,
            startLife: new IntervalValue(1.2, 2.5),
            startSpeed: new IntervalValue(0.5, 4),
            startSize: new IntervalValue(2, 5),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new RandomColor(new THREE.Vector4(0.5, 0.5, 0.5, 0.5), new THREE.Vector4(0.8, 0.8, 0.8, 0.7)),
            worldSpace: true, maxParticle: 25,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [
                { time: 0, count: new ConstantValue(12), cycle: 1, interval: 0.01, probability: 1 },
                { time: 0.2, count: new ConstantValue(6), cycle: 1, interval: 0.01, probability: 1 },
            ],
            shape: new SphereEmitter({ radius: 0.7, arc: Math.PI * 2, thickness: 1 }),
            material: this._makeSmokeMat(),
            renderMode: RenderMode.BillBoard, renderOrder: -1, autoDestroy: true,
        });
        smoke.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(0.7, 0.7, 0.7, 0.6), new THREE.Vector4(0.3, 0.3, 0.3, 0))));
        smoke.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.3, 0.6, 1, 0.9), 0]])));
        smoke.addBehavior(new RotationOverLife(new IntervalValue(-Math.PI / 4, Math.PI / 4)));
        smoke.addBehavior(new ApplyForce(new THREE.Vector3(0, 7, 0), new ConstantValue(1)));
        this._addSystem(smoke, worldPos);
    }
}


// ── Helper Classes for Lightning VFX ──────────────────────────────────────────────────

class LightningBolt {
    constructor(scene, flashLight) {
        this.scene = scene;
        this.flashLight = flashLight;
        this.bolts = [];
        this.glowBolts = [];
        this.active = false;
        this.lifetime = 0;
        this.maxLifetime = 0.4;
        this.flickerTimer = 0;
        this.flickerInterval = 0.04;
        this.strikePos = new THREE.Vector3();
        this.impactGroup = new THREE.Group();
        this.scene.add(this.impactGroup);
    }

    _generateBoltPath(start, end, segments = 12, jitter = 2.5) {
        const points = [start.clone()];
        const dir = new THREE.Vector3().subVectors(end, start);
        dir.normalize();

        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            const p = new THREE.Vector3().lerpVectors(start, end, t);
            const offsetScale = jitter * Math.sin(t * Math.PI);
            p.x += (Math.random() - 0.5) * 2 * offsetScale;
            p.z += (Math.random() - 0.5) * 2 * offsetScale;
            p.y += (Math.random() - 0.5) * jitter * 0.3;
            points.push(p);
        }
        points.push(end.clone());
        return points;
    }

    _createBoltLine(points, color, linewidth = 1, opacity = 1) {
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({
            color, transparent: true, opacity,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        return line;
    }

    _createGlowTube(points, color, radius = 0.15, opacity = 0.4) {
        const curve = new THREE.CatmullRomCurve3(points);
        const geo = new THREE.TubeGeometry(curve, points.length * 2, radius, 6, false);
        const mat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        this.scene.add(mesh);
        return mesh;
    }

    _createImpactSparks(pos) {
        // Ground ring flash
        const ringGeo = new THREE.RingGeometry(0.5, 3, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x88ccff, transparent: true, opacity: 0.8,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(pos);
        ring.position.y = 0.05;
        ring.rotation.x = -Math.PI / 2;
        this.impactGroup.add(ring);

        // Radial spark lines
        for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
            const len = 1.5 + Math.random() * 3;
            const sparkPoints = [];
            const segs = 4 + Math.floor(Math.random() * 3);
            for (let j = 0; j <= segs; j++) {
                const t = j / segs;
                sparkPoints.push(new THREE.Vector3(
                    pos.x + Math.cos(angle) * len * t + (Math.random() - 0.5) * 0.3,
                    0.1 + Math.random() * 0.5 * (1 - t),
                    pos.z + Math.sin(angle) * len * t + (Math.random() - 0.5) * 0.3,
                ));
            }
            const sparkGeo = new THREE.BufferGeometry().setFromPoints(sparkPoints);
            const sparkMat = new THREE.LineBasicMaterial({
                color: new THREE.Color().setHSL(0.58 + Math.random() * 0.08, 0.9, 0.7 + Math.random() * 0.3),
                transparent: true, opacity: 0.9,
                blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const sparkLine = new THREE.Line(sparkGeo, sparkMat);
            this.impactGroup.add(sparkLine);
        }

        // Ground scorch glow
        const glowGeo = new THREE.CircleGeometry(2, 32);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0x4488ff, transparent: true, opacity: 0.6,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.copy(pos);
        glow.position.y = 0.02;
        glow.rotation.x = -Math.PI / 2;
        this.impactGroup.add(glow);
    }

    strike(targetPos, startPos = null) {
        this.cleanup();
        this.strikePos.copy(targetPos);
        this.sourcePos = startPos || new THREE.Vector3(
            targetPos.x + (Math.random() - 0.5) * 6,
            40 + Math.random() * 15,
            targetPos.z + (Math.random() - 0.5) * 6
        );

        this.active = true;
        this.lifetime = 0;
        this._buildBolt(this.sourcePos, targetPos);
        this._createImpactSparks(targetPos);

        if (this.flashLight) {
            this.flashLight.position.copy(targetPos);
            this.flashLight.position.y = 10;
            this.flashLight.intensity = 30;
            this.flashLight.color.setHex(0x88aaff);
        }
    }

    _buildBolt(skyPos, targetPos) {
        const mainPath = this._generateBoltPath(skyPos, targetPos, 14, 3.0);
        this.bolts.push(this._createBoltLine(mainPath, 0xffffff, 2, 1.0));
        this.glowBolts.push(this._createGlowTube(mainPath, 0x6688ff, 0.3, 0.5));
        this.glowBolts.push(this._createGlowTube(mainPath, 0x4466cc, 0.7, 0.2));

        const mainPath2 = this._generateBoltPath(skyPos, targetPos, 10, 2.0);
        this.bolts.push(this._createBoltLine(mainPath2, 0xaaccff, 1, 0.7));

        for (let i = 0; i < mainPath.length; i++) {
            if (Math.random() < 0.35 && i > 2 && i < mainPath.length - 2) {
                const branchStart = mainPath[i].clone();
                const branchEnd = branchStart.clone().add(new THREE.Vector3(
                    (Math.random() - 0.5) * 10, -(2 + Math.random() * 6), (Math.random() - 0.5) * 10,
                ));
                const branchPath = this._generateBoltPath(branchStart, branchEnd, 5, 1.5);
                this.bolts.push(this._createBoltLine(branchPath, 0x88aaff, 1, 0.6));
                this.glowBolts.push(this._createGlowTube(branchPath, 0x4466cc, 0.15, 0.25));

                if (Math.random() < 0.4 && branchPath.length > 2) {
                    const subStart = branchPath[Math.floor(branchPath.length / 2)].clone();
                    const subEnd = subStart.clone().add(new THREE.Vector3(
                        (Math.random() - 0.5) * 5, -(1 + Math.random() * 3), (Math.random() - 0.5) * 5,
                    ));
                    const subPath = this._generateBoltPath(subStart, subEnd, 3, 0.8);
                    this.bolts.push(this._createBoltLine(subPath, 0x6688cc, 1, 0.4));
                }
            }
        }
    }

    _flicker() {
        for (const b of this.bolts) { this.scene.remove(b); b.geometry?.dispose(); b.material?.dispose(); }
        for (const g of this.glowBolts) { this.scene.remove(g); g.geometry?.dispose(); g.material?.dispose(); }
        this.bolts = [];
        this.glowBolts = [];

        // Re-use sourcePos so custom starting points don't snap to the sky
        const flickerSource = this.sourcePos ? this.sourcePos.clone() : new THREE.Vector3(
            this.strikePos.x + (Math.random() - 0.5) * 4,
            40 + Math.random() * 15,
            this.strikePos.z + (Math.random() - 0.5) * 4
        );
        this._buildBolt(flickerSource, this.strikePos);
    }

    update(delta) {
        if (!this.active) return;
        this.lifetime += delta;

        this.flickerTimer += delta;
        if (this.flickerTimer >= this.flickerInterval) {
            this.flickerTimer = 0;
            if (this.lifetime < this.maxLifetime * 0.7) this._flicker();
        }

        const fadeT = Math.max(0, 1 - this.lifetime / this.maxLifetime);
        for (const b of this.bolts) if (b.material) b.material.opacity = fadeT;
        for (const g of this.glowBolts) if (g.material) g.material.opacity = fadeT * 0.4;

        if (this.flashLight) this.flashLight.intensity = 30 * fadeT * fadeT;

        this.impactGroup.children.forEach(c => {
            if (c.material) c.material.opacity = fadeT;
        });

        if (this.lifetime >= this.maxLifetime) this.cleanup();
    }

    cleanup() {
        for (const b of this.bolts) { this.scene.remove(b); b.geometry?.dispose(); b.material?.dispose(); }
        for (const g of this.glowBolts) { this.scene.remove(g); g.geometry?.dispose(); g.material?.dispose(); }
        this.bolts = [];
        this.glowBolts = [];
        this.active = false;
        if (this.flashLight) this.flashLight.intensity = 0;

        while (this.impactGroup.children.length > 0) {
            const c = this.impactGroup.children[0];
            c.geometry?.dispose();
            c.material?.dispose();
            this.impactGroup.remove(c);
        }
    }
}

class WarningCircle {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.innerMesh = null;
        this.active = false;
        this.timer = 0;
        this.duration = 0.2; // Speed up lightning strike to 0.2s (extremely fast)
        this.pos = new THREE.Vector3();
        this.onComplete = null;
    }

    show(pos, onComplete) {
        this.cleanup();
        this.pos.copy(pos);
        this.active = true;
        this.timer = 0;
        this.onComplete = onComplete;

        const ringGeo = new THREE.RingGeometry(1.5, 2.0, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xff4444, transparent: true, opacity: 0.6,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
        });
        this.mesh = new THREE.Mesh(ringGeo, ringMat);
        this.mesh.position.set(pos.x, 0.05, pos.z);
        this.mesh.rotation.x = -Math.PI / 2;
        this.scene.add(this.mesh);

        const fillGeo = new THREE.CircleGeometry(1.5, 32);
        const fillMat = new THREE.MeshBasicMaterial({
            color: 0xff2222, transparent: true, opacity: 0.15,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
        });
        this.innerMesh = new THREE.Mesh(fillGeo, fillMat);
        this.innerMesh.position.set(pos.x, 0.03, pos.z);
        this.innerMesh.rotation.x = -Math.PI / 2;
        this.scene.add(this.innerMesh);
    }

    update(delta) {
        if (!this.active) return;
        this.timer += delta;

        const pulse = 1 + Math.sin(this.timer * 12) * 0.15;
        if (this.mesh) {
            this.mesh.scale.setScalar(pulse);
            this.mesh.material.opacity = 0.4 + Math.sin(this.timer * 8) * 0.3;
        }
        if (this.innerMesh) {
            this.innerMesh.material.opacity = 0.1 + (this.timer / this.duration) * 0.3;
            this.innerMesh.scale.setScalar(pulse * 0.9);
        }

        if (this.timer >= this.duration) {
            const pos = this.pos.clone();
            this.cleanup();
            if (this.onComplete) this.onComplete(pos);
        }
    }

    cleanup() {
        if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry?.dispose(); this.mesh.material?.dispose(); this.mesh = null; }
        if (this.innerMesh) { this.scene.remove(this.innerMesh); this.innerMesh.geometry?.dispose(); this.innerMesh.material?.dispose(); this.innerMesh = null; }
        this.active = false;
    }
}
