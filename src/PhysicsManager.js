import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/**
 * PhysicsManager - Rapier.js物理エンジン管理
 * 単一カプセルボディでラグドールを実装
 * メッシュオフセットをボディの回転に連動させて正確に追従
 */
export class PhysicsManager {
    constructor() {
        this.world = null;
        this.initialized = false;
        this.ragdolls = {}; // playerId -> ragdoll data
    }

    async init() {
        await RAPIER.init();
        // Massively increased gravity so the player drops fast when dying instead of floating
        const gravity = { x: 0.0, y: -40.0, z: 0.0 };
        this.world = new RAPIER.World(gravity);
        this.createGroundPlane();
        this.initialized = true;
        console.log('[PhysicsManager] Rapier.js initialized');
        return this;
    }

    createGroundPlane() {
        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed()
            .setTranslation(0.0, 0.0, 0.0);
        const groundBody = this.world.createRigidBody(groundBodyDesc);
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100.0, 0.1, 100.0);
        this.world.createCollider(groundColliderDesc, groundBody);
    }

    update(delta) {
        if (!this.initialized || !this.world) return;

        // Calculate physics steps strictly based on time to ensure identical fall speeds on all PCs
        this.accumulator = (this.accumulator || 0) + delta;
        const timeStep = 1.0 / 60.0;

        // Cap accumulator to avoid "death spirals" on severe lag spikes
        if (this.accumulator > 0.1) this.accumulator = 0.1;

        while (this.accumulator >= timeStep) {
            this.world.step();
            this.accumulator -= timeStep;
        }

        for (const id in this.ragdolls) {
            this.syncRagdollToMesh(id);
        }
    }

    /**
     * 指定された位置とサイズで静的な衝突ボックス（壁・床など）を追加する
     */
    addStaticBox(position, width, height, depth) {
        if (!this.initialized || !this.world) return;

        const bodyDesc = RAPIER.RigidBodyDesc.fixed()
            .setTranslation(position.x, position.y, position.z);
        const body = this.world.createRigidBody(bodyDesc);

        // Rapier takes half-extents (hx, hy, hz) for cuboids
        const colliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2);
        this.world.createCollider(colliderDesc, body);

        console.log(`[PhysicsManager] Added Static Box at ${position.x}, ${position.y}, ${position.z} measuring ${width}x${height}x${depth}`);
        return body;
    }

    /**
     * プレイヤー死亡時にラグドールを生成（単一カプセルボディ方式）
     * カプセルが地面に倒れ、メッシュが物理ボディに追従する
     */
    createRagdoll(player, impulseDir, scene) {
        if (!this.initialized) return;
        if (this.ragdolls[player.id]) {
            this.removeRagdoll(player.id);
        }

        const pos = player.mesh.position.clone();
        const rot = player.mesh.rotation.y;

        // プレイヤーの向きからクォータニオンを作成
        const initQuat = new THREE.Quaternion();
        initQuat.setFromEuler(new THREE.Euler(0, rot, 0));

        // プレイヤーモデルの重心高さ（立位時の腰の高さ）
        const centerOfMassY = 0.85;

        // 単一のダイナミックボディを作成（直方体・キューブ型に変更して転がりを防止）
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(pos.x, pos.y + centerOfMassY, pos.z)
            .setRotation({ x: initQuat.x, y: initQuat.y, z: initQuat.z, w: initQuat.w })
            .setLinearDamping(2.0)
            .setAngularDamping(20.0); // 極めて強いブレーキ。倒れたあとの転がりを完全に防ぎ、腕のちらつきをなくす

        const body = this.world.createRigidBody(bodyDesc);

        // カプセルコライダー（全長約1.5m）。角がないため引っかからず自然に倒れ込める。
        const colliderDesc = RAPIER.ColliderDesc.capsule(0.55, 0.2)
            .setMass(10.0)
            .setRestitution(0.0) // 反発ゼロ
            .setFriction(5.0);   // 激しい摩擦をかけて滑り・転がりを物理的に停止させる

        this.world.createCollider(colliderDesc, body);

        const ragdoll = {
            body: body,
            playerMesh: player.mesh,
            centerOfMassY: centerOfMassY, // ローカル空間でのメッシュ原点からの重心オフセット
        };

        // 弾の方向にインパルスを適用
        if (impulseDir) {
            const force = 20.0; // Increased massively for a heavy impact feel
            body.applyImpulse({
                x: impulseDir.x * force,
                y: -10.0, // Smash downwards instead of popping up
                z: impulseDir.z * force,
            }, true);
            body.applyTorqueImpulse({
                x: -impulseDir.z * 5.0,
                y: 0,
                z: impulseDir.x * 5.0,
            }, true);
        } else {
            body.applyTorqueImpulse({ x: 5.0, y: 0, z: 2.5 }, true);
        }

        this.ragdolls[player.id] = ragdoll;
        console.log(`[PhysicsManager] Ragdoll created for player ${player.id}`);
    }

    /**
     * 物理ボディの位置・回転をプレイヤーメッシュに同期
     * オフセットを物理ボディの回転で変換して正確な位置を計算
     */
    syncRagdollToMesh(playerId) {
        const ragdoll = this.ragdolls[playerId];
        if (!ragdoll || !ragdoll.playerMesh || !ragdoll.body) return;

        const bodyPos = ragdoll.body.translation();
        const bodyRot = ragdoll.body.rotation();

        // メッシュ原点（足元）は重心から -centerOfMassY 下にある
        const localOffset = new THREE.Vector3(0, -ragdoll.centerOfMassY, 0);
        const bodyQuat = new THREE.Quaternion(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w);
        localOffset.applyQuaternion(bodyQuat);

        // メッシュ位置 = ボディ位置 + 回転済みオフセット
        ragdoll.playerMesh.position.set(
            bodyPos.x + localOffset.x,
            bodyPos.y + localOffset.y,
            bodyPos.z + localOffset.z
        );

        // メッシュの回転をボディに追従
        ragdoll.playerMesh.quaternion.set(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w);
    }

    removeRagdoll(playerId) {
        const ragdoll = this.ragdolls[playerId];
        if (!ragdoll) return;

        if (ragdoll.body) {
            try {
                this.world.removeRigidBody(ragdoll.body);
            } catch (e) { /* already removed */ }
        }

        ragdoll.playerMesh = null;
        delete this.ragdolls[playerId];
        console.log(`[PhysicsManager] Ragdoll removed for player ${playerId}`);
    }

    /**
     * ネットワーク同期用: ラグドール状態を取得
     */
    getRagdollState(playerId) {
        const ragdoll = this.ragdolls[playerId];
        if (!ragdoll || !ragdoll.body) return null;

        const pos = ragdoll.body.translation();
        const rot = ragdoll.body.rotation();
        return {
            pos: { x: pos.x, y: pos.y, z: pos.z },
            rot: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
        };
    }

    /**
     * リモートプレイヤーのラグドール状態をメッシュに反映
     */
    updateRagdollFromState(playerId, state, scene, remoteMesh) {
        let ragdoll = this.ragdolls[playerId];

        if (!ragdoll) {
            ragdoll = {
                body: null,
                playerMesh: remoteMesh || null,
                centerOfMassY: 0.85,
            };
            this.ragdolls[playerId] = ragdoll;
        }

        if (remoteMesh && !ragdoll.playerMesh) {
            ragdoll.playerMesh = remoteMesh;
        }

        if (ragdoll.playerMesh && state.pos && state.rot) {
            // 回転済みオフセットでメッシュ位置を計算
            const localOffset = new THREE.Vector3(0, -ragdoll.centerOfMassY, 0);
            const bodyQuat = new THREE.Quaternion(state.rot.x, state.rot.y, state.rot.z, state.rot.w);
            localOffset.applyQuaternion(bodyQuat);

            const meshY = Math.max(0, state.pos.y + localOffset.y);
            ragdoll.playerMesh.position.set(
                state.pos.x + localOffset.x,
                meshY,
                state.pos.z + localOffset.z
            );
            ragdoll.playerMesh.quaternion.set(state.rot.x, state.rot.y, state.rot.z, state.rot.w);
        }
    }

    dispose() {
        for (const id in this.ragdolls) {
            this.removeRagdoll(id);
        }
        if (this.world) {
            this.world.free();
            this.world = null;
        }
        this.initialized = false;
    }
}
