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
        fireball.addBehavior(new RotationOverLife(new IntervalValue(-Math.PI / 2, Math.PI / 2)));
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

