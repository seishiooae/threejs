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

/**
 * VFXManager – demo.quarks.art quality particle effects.
 * Uses the official three.quarks 10x10 texture atlas with:
 *  - FrameOverLife (animated sprite frames)
 *  - ColorOverLife (smooth color gradients)
 *  - RotationOverLife (organic spinning)
 *  - StretchedBillBoard (spark trails)
 *  - Multi-layered systems per effect
 *
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

        // Load texture atlas (10x10 sprite sheet from quarks.art)
        const loader = new THREE.TextureLoader();
        loader.load('/textures/texture1.png', (tex) => {
            this.texture = tex;
            this._ready = true;
            console.log('[VFX] Texture atlas loaded');
        }, undefined, (err) => {
            console.warn('[VFX] Texture atlas failed to load, falling back to untextured:', err);
            this._ready = true; // Allow untextured fallback
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

    /** Large fireball explosion with smoke */
    explosion(worldPos) {
        if (!this._ready) return;
        this._createExplosionGroup(worldPos);
    }

    /** Call every frame */
    update(delta) {
        this.batchRenderer.update(delta);

        // Cull systems that have completed and have no live particles
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

    _makeMat(blending = THREE.AdditiveBlending) {
        return new THREE.MeshBasicMaterial({
            map: this.texture,
            blending: blending,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  MUZZLE FLASH  (matching demo.quarks.art/vanilla.html)
    // ═══════════════════════════════════════════════════════════════════

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

        // Layer 3: Hot sparks (stretched billboard – streak effect)
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

    // ═══════════════════════════════════════════════════════════════════
    //  MISSILE LAUNCH (propellant blast)
    // ═══════════════════════════════════════════════════════════════════

    _createMissileLaunchGroup(worldPos) {
        // Layer 1: Central flash (bright burst)
        const flash = new ParticleSystem({
            duration: 0.5,
            looping: false,
            startLife: new IntervalValue(0.1, 0.25),
            startSpeed: new ConstantValue(0),
            startSize: new IntervalValue(1.5, 3),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new ConstantColor(new THREE.Vector4(1, 0.5, 0.1, 1)),
            worldSpace: false,
            maxParticle: 5,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(1), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new PointEmitter(),
            material: this._makeMat(),
            startTileIndex: new ConstantValue(91),
            uTileCount: 10,
            vTileCount: 10,
            renderMode: RenderMode.BillBoard,
            renderOrder: 2,
            autoDestroy: true,
        });
        flash.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 0.6, 0.1, 1), new THREE.Vector4(1, 0.2, 0.0, 0))));
        flash.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.95, 0.75, 0), 0]])));
        flash.addBehavior(new FrameOverLife(new PiecewiseBezier([[new Bezier(91, 94, 97, 100), 0]])));
        this._addSystem(flash, worldPos);

        // Layer 2: Embers flying out
        const embers = new ParticleSystem({
            duration: 0.5,
            looping: false,
            startLife: new IntervalValue(0.3, 0.6),
            startSpeed: new IntervalValue(2, 8),
            startSize: new IntervalValue(0.1, 0.25),
            startColor: new RandomColor(new THREE.Vector4(1, 0.7, 0.2, 1), new THREE.Vector4(1, 0.4, 0.05, 1)),
            worldSpace: true,
            maxParticle: 20,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(12), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new SphereEmitter({ radius: 0.15, arc: Math.PI * 2, thickness: 1 }),
            material: this._makeMat(),
            startTileIndex: new ConstantValue(0),
            uTileCount: 10,
            vTileCount: 10,
            renderMode: RenderMode.StretchedBillBoard,
            speedFactor: 0.3,
            renderOrder: 1,
            autoDestroy: true,
        });
        embers.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.95, 0.75, 0), 0]])));
        embers.addBehavior(new ApplyForce(new THREE.Vector3(0, 3, 0), new ConstantValue(1)));
        this._addSystem(embers, worldPos);

        // Layer 3: Smoke puff
        const smoke = new ParticleSystem({
            duration: 1.5,
            looping: false,
            startLife: new IntervalValue(0.5, 0.8),
            startSpeed: new IntervalValue(0.1, 2),
            startSize: new IntervalValue(0.5, 1.2),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new RandomColor(new THREE.Vector4(0.6, 0.6, 0.6, 0.25), new THREE.Vector4(1, 1, 1, 0.4)),
            worldSpace: true,
            maxParticle: 8,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(4), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new SphereEmitter({ radius: 0.2, arc: Math.PI * 2, thickness: 1 }),
            material: this._makeMat(THREE.NormalBlending),
            startTileIndex: new ConstantValue(81),
            uTileCount: 10,
            vTileCount: 10,
            renderMode: RenderMode.BillBoard,
            renderOrder: -2,
            autoDestroy: true,
        });
        smoke.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 1, 1, 1), new THREE.Vector4(1, 1, 1, 0))));
        smoke.addBehavior(new RotationOverLife(new IntervalValue(-Math.PI / 4, Math.PI / 4)));
        smoke.addBehavior(new FrameOverLife(new PiecewiseBezier([[new Bezier(28, 31, 34, 37), 0]])));
        smoke.addBehavior(new ApplyForce(new THREE.Vector3(0, 2, 0), new ConstantValue(1)));
        this._addSystem(smoke, worldPos);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  EXPLOSION  (fireball + shockwave + debris + smoke)
    // ═══════════════════════════════════════════════════════════════════

    _createExplosionGroup(worldPos) {
        // Layer 1: Bright core flash
        const core = new ParticleSystem({
            duration: 0.5,
            looping: false,
            startLife: new IntervalValue(0.15, 0.3),
            startSpeed: new ConstantValue(0),
            startSize: new IntervalValue(3, 6),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new ConstantColor(new THREE.Vector4(1, 0.8, 0.3, 1)),
            worldSpace: true,
            maxParticle: 5,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(2), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new PointEmitter(),
            material: this._makeMat(),
            startTileIndex: new ConstantValue(1),
            uTileCount: 10,
            vTileCount: 10,
            renderMode: RenderMode.BillBoard,
            renderOrder: 3,
            autoDestroy: true,
        });
        core.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.2, 1, 0.75, 0), 0]])));
        core.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 1, 0.8, 1), new THREE.Vector4(1, 0.3, 0.0, 0))));
        this._addSystem(core, worldPos);

        // Layer 2: Animated fire sprites
        const fire = new ParticleSystem({
            duration: 0.5,
            looping: false,
            startLife: new IntervalValue(0.3, 0.6),
            startSpeed: new IntervalValue(2, 8),
            startSize: new IntervalValue(1, 3),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new ConstantColor(new THREE.Vector4(1, 1, 1, 1)),
            worldSpace: true,
            maxParticle: 20,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(12), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new SphereEmitter({ radius: 0.3, arc: Math.PI * 2, thickness: 1 }),
            material: this._makeMat(),
            startTileIndex: new ConstantValue(91),
            uTileCount: 10,
            vTileCount: 10,
            renderMode: RenderMode.BillBoard,
            renderOrder: 2,
            autoDestroy: true,
        });
        fire.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 0.6, 0.1, 1), new THREE.Vector4(1, 0.2, 0.0, 0))));
        fire.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.5, 1, 0.75, 0), 0]])));
        fire.addBehavior(new FrameOverLife(new PiecewiseBezier([[new Bezier(91, 94, 97, 100), 0]])));
        fire.addBehavior(new RotationOverLife(new IntervalValue(-Math.PI / 3, Math.PI / 3)));
        this._addSystem(fire, worldPos);

        // Layer 3: Hot debris sparks (stretched)
        const debris = new ParticleSystem({
            duration: 0.5,
            looping: false,
            startLife: new IntervalValue(0.3, 0.8),
            startSpeed: new IntervalValue(5, 20),
            startSize: new IntervalValue(0.1, 0.4),
            startColor: new RandomColor(new THREE.Vector4(1, 0.91, 0.51, 1), new THREE.Vector4(1, 0.44, 0.16, 1)),
            worldSpace: true,
            maxParticle: 30,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(20), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new SphereEmitter({ radius: 0.2, arc: Math.PI * 2, thickness: 1 }),
            material: this._makeMat(),
            startTileIndex: new ConstantValue(0),
            uTileCount: 10,
            vTileCount: 10,
            renderMode: RenderMode.StretchedBillBoard,
            speedFactor: 0.5,
            renderOrder: 1,
            autoDestroy: true,
        });
        debris.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.95, 0.75, 0), 0]])));
        debris.addBehavior(new ApplyForce(new THREE.Vector3(0, -8, 0), new ConstantValue(1)));
        this._addSystem(debris, worldPos);

        // Layer 4: Smoke cloud (fading, rising)
        const smoke = new ParticleSystem({
            duration: 2,
            looping: false,
            startLife: new IntervalValue(0.8, 1.5),
            startSpeed: new IntervalValue(0.5, 3),
            startSize: new IntervalValue(1, 3),
            startRotation: new IntervalValue(-Math.PI, Math.PI),
            startColor: new RandomColor(new THREE.Vector4(0.5, 0.5, 0.5, 0.3), new THREE.Vector4(0.8, 0.8, 0.8, 0.5)),
            worldSpace: true,
            maxParticle: 15,
            emissionOverTime: new ConstantValue(0),
            emissionBursts: [{ time: 0, count: new ConstantValue(8), cycle: 1, interval: 0.01, probability: 1 }],
            shape: new SphereEmitter({ radius: 0.5, arc: Math.PI * 2, thickness: 1 }),
            material: this._makeMat(THREE.NormalBlending),
            startTileIndex: new ConstantValue(81),
            uTileCount: 10,
            vTileCount: 10,
            renderMode: RenderMode.BillBoard,
            renderOrder: -1,
            autoDestroy: true,
        });
        smoke.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1, 1, 1, 0.6), new THREE.Vector4(0.7, 0.7, 0.7, 0))));
        smoke.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.5, 1, 1, 0.8), 0]])));
        smoke.addBehavior(new RotationOverLife(new IntervalValue(-Math.PI / 4, Math.PI / 4)));
        smoke.addBehavior(new FrameOverLife(new PiecewiseBezier([[new Bezier(28, 31, 34, 37), 0]])));
        smoke.addBehavior(new ApplyForce(new THREE.Vector3(0, 4, 0), new ConstantValue(1)));
        this._addSystem(smoke, worldPos);
    }
}
