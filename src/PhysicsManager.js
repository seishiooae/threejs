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
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
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
        this.world.step();

        for (const id in this.ragdolls) {
            this.syncRagdollToMesh(id);
        }
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

        // 単一のダイナミックボディを作成（カプセル型）
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(pos.x, pos.y + centerOfMassY, pos.z)
            .setRotation({ x: initQuat.x, y: initQuat.y, z: initQuat.z, w: initQuat.w })
            .setLinearDamping(0.0)
            .setAngularDamping(0.1);

        const body = this.world.createRigidBody(bodyDesc);

        // カプセルコライダー: half_height=0.55, radius=0.2 → 全長約1.5m
        const colliderDesc = RAPIER.ColliderDesc.capsule(0.55, 0.2)
            .setMass(10.0)
            .setRestitution(0.05)
            .setFriction(1.0);

        this.world.createCollider(colliderDesc, body);

        const ragdoll = {
            body: body,
            playerMesh: player.mesh,
            centerOfMassY: centerOfMassY, // ローカル空間でのメッシュ原点からの重心オフセット
        };

        // 弾の方向にインパルスを適用
        if (impulseDir) {
            const force = 6.0;
            body.applyImpulse({
                x: impulseDir.x * force,
                y: 2.0,
                z: impulseDir.z * force,
            }, true);
            body.applyTorqueImpulse({
                x: -impulseDir.z * 3.0,
                y: 0,
                z: impulseDir.x * 3.0,
            }, true);
        } else {
            body.applyTorqueImpulse({ x: 2.0, y: 0, z: 1.0 }, true);
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
