import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { TransformControls } from './vendor/TransformControls.js';


export class Player {
    constructor(game, id, isLocal = false) {
        this.game = game;
        this.id = id;
        this.isLocal = isLocal;

        // The visual representation of the player (what others see, and what we see in TPS)
        this.mesh = new THREE.Group();

        // The object controlled by inputs (Position/Rotation center)
        this.pivot = new THREE.Object3D();

        this.camera = null;
        this.controls = null;
        this.isThirdPerson = true; // Default View changed to TPS

        // Physics/Movement
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
        this.canJump = false;
        this.onGround = false; // Added for physics

        // Animation
        this.mixer = null;
        this.isThirdPerson = true;

        // --- Stun Mechanics ---
        this.stunCount = 0;
        this.isStunned = false;

        this.animations = {};
        this.currentAction = 'Idle';
        this.state = 'Idle'; // Added for animation state management

        // Wrapper for FBX model to separate rotations
        // mesh handles Y rotation (yaw), modelWrapper handles X rotation (stand up)
        this.modelWrapper = null;

        // Health System
        this.maxHealth = 100;
        this.health = this.maxHealth;
        this.isDead = false;
        this.isInvincible = false;

        this.init();
        this.autoLoadModels();
    }

    takeDamage(amount, direction, explosionForce = 0) {
        if (this.isDead || this.isInvincible) return;

        this.health -= amount;
        console.log(`[Player ${this.id}] Took ${amount} damage. Health: ${this.health}`);

        // Apply knockback if it's an explosive hit (e.g., from Homing Missiles)
        if (explosionForce > 0 && direction && this.isLocal) {
            this.velocity.add(direction.clone().multiplyScalar(explosionForce));
        }

        // Store last hit direction and time for reactions/ragdoll
        this.lastHitDirection = direction || null;
        this.lastHitTime = performance.now();

        // Trigger the hit reaction from the very beginning
        if (this.animations && this.animations['Hit']) {
            this.animations['Hit'].reset().play();
        }

        // Update 3D health bar (for remote players)
        if (this.drawHealthBar) this.drawHealthBar();

        if (this.health <= 0) {
            this.die(this.lastHitDirection);
        }
    }

    die(impulseDirection) {
        if (this.isDead) return;
        this.isDead = true;
        console.log(`[Player ${this.id}] DIED!`);

        // Create ragdoll using PhysicsManager (mesh follows physics automatically)
        // ONLY the local player simulates their own ragdoll physics body. Network will sync it to others.
        if (this.isLocal && this.game && this.game.physicsManager) {
            this.game.physicsManager.createRagdoll(this, impulseDirection, this.game.scene);
        } else {
            // Fallback since ragdoll is removed: Tumble the player over
            if (this.mesh) {
                // Tumble backwards flat on the ground
                this.mesh.rotation.x = -Math.PI / 2;
                this.mesh.position.y = 0.2; // roughly ground level
            }
        }

        // Freeze animations at current pose now that player is tumbled
        if (this.mixer) {
            this.mixer.timeScale = 0;
        }

        // Hide weapon during dead state (attached to hand bone, looks odd when flat)
        if (this.weapon) {
            this.weapon.visible = false;
        }

        // Hide health bar sprite during ragdoll
        if (this.healthBarSprite) {
            this.healthBarSprite.visible = false;
        }

        // Respawn after 10 seconds (longer time on ground)
        setTimeout(() => {
            this.respawn();
        }, 10000);
    }

    respawn() {
        // Remove ragdoll
        if (this.game && this.game.physicsManager) {
            this.game.physicsManager.removeRagdoll(this.id);
        }

        // Notify other clients that ragdoll has ended
        if (this.isLocal && this.game && this.game.networkManager) {
            this.game.networkManager.sendRagdollEnd();
        }
        this.isDead = false;
        this.isStunned = false;
        this.stunCount = 0;
        this.health = this.maxHealth;
        this.velocity.set(0, 0, 0);
        // Unfreeze animations
        if (this.mixer) {
            this.mixer.timeScale = 1.0;
        }

        // Restore mesh visibility and reset rotation
        if (this.mesh) {
            this.mesh.visible = true;
            // Reset mesh rotation (physics may have tumbled it)
            this.mesh.quaternion.identity();
        }
        if (this.weapon) {
            this.weapon.visible = true;
        }

        // Restore health bar sprite
        if (this.healthBarSprite) {
            this.healthBarSprite.visible = true;
        }

        // Grant 3 seconds of invulnerability
        this.isInvincible = true;
        setTimeout(() => {
            this.isInvincible = false;
            console.log(`[Player ${this.id}] Invulnerability ended.`);
        }, 3000);

        // Update health bar
        if (this.drawHealthBar) this.drawHealthBar();

        const spawnPos = this.getSpawnPosition();

        if (this.isLocal) {
            this.pivot.position.set(spawnPos.x, 1.6, spawnPos.z);
            this.velocity.set(0, 0, 0);
        } else {
            this.mesh.position.set(spawnPos.x, 0, spawnPos.z);
        }

        // Restart animations
        if (this.mixer) {
            this.mixer.timeScale = 1;
            this.mixer.stopAllAction();
            if (this.animations['Idle']) {
                this.animations['Idle'].reset().play();
                this.currentAction = 'Idle';
            }
        }

        // Reset ragdoll state
        this.isRagdolling = false;
        this.ragdollTime = 0;
        this.ragdollOriginalBones = null;

        console.log(`[Player ${this.id}] Respawned at ${spawnPos.x.toFixed(1)}, ${spawnPos.z.toFixed(1)}`);
    }

    /**
     * ラグドール中のボーン脱力アニメーション（IK＋重力追従型）
     * 各関節が重力に引かれて自由に揺れ、地面（Y=0.15）に達すると体に沿って広がる
     */
    updateRagdollPose(delta) {
        if (!this.isRagdolling) return;

        // Cap animation delta to protect IK math from blowing up on low framerates (max ~20fps step)
        const safeDelta = Math.min(delta, 0.05);
        this.ragdollTime += safeDelta;

        // Stop calculating IK after 2.0 seconds to completely freeze the pose and prevent ANY micro-flickering on the ground
        if (this.ragdollTime > 2.0) {
            return;
        }

        // 初回: 各ボーンの初期状態と階層情報を保存
        if (!this.ragdollOriginalBones) {
            this.ragdollOriginalBones = {};
            this.ragdollPairs = [];

            const addPair = (parent, child, weight, isLeg = false, tag = '') => {
                if (parent && child) {
                    this.ragdollOriginalBones[parent.name] = parent.quaternion.clone();
                    // 子ボーンの初期ローカル位置から「基準となる向き（restDir）」を計算
                    let restDir = child.position.clone();
                    if (restDir.lengthSq() < 0.0001) restDir.set(0, 1, 0); // ゼロベクトル回避
                    restDir.normalize();

                    // 手足が一箇所にまとまらないよう、部位に応じた強制的な広がり方向（Sprawl Direction）を定義する
                    let sprawlDir = new THREE.Vector3(0, 0, 0);

                    // プレイヤー自身の向き（ローカル空間からワールド空間へのZ/X軸）を基準にする
                    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion).normalize();
                    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.mesh.quaternion).normalize();

                    if (tag.includes('RightArm')) {
                        sprawlDir.copy(right).add(forward.clone().multiplyScalar(0.7)).normalize();
                    } else if (tag.includes('LeftArm')) {
                        sprawlDir.copy(right).multiplyScalar(-1).add(forward.clone().multiplyScalar(0.7)).normalize();
                    } else if (tag.includes('RightLeg')) {
                        sprawlDir.copy(right).add(forward.clone().multiplyScalar(-0.7)).normalize();
                    } else if (tag.includes('LeftLeg')) {
                        sprawlDir.copy(right).multiplyScalar(-1).add(forward.clone().multiplyScalar(-0.7)).normalize();
                    } else if (tag.includes('Head')) {
                        sprawlDir.copy(forward).normalize();
                    } else {
                        // Spineなどは広がらない
                        sprawlDir.set(0, 0, 0);
                    }

                    this.ragdollPairs.push({ parent, child, restDir, weight, isLeg, sprawlDir, tag });
                }
            };

            const getFirstChild = (bone) => bone && bone.children.length > 0 ? bone.children[0] : null;

            // 腕 (外側・前方に強制スプロール)
            // 重みを下げて極端に曲がらないようにする
            addPair(this.rightArmBone, this.rightForeArmBone, 0.4, false, 'RightArm');
            addPair(this.leftArmBone, this.leftForeArmBone, 0.4, false, 'LeftArm');
            addPair(this.rightForeArmBone, getFirstChild(this.rightForeArmBone), 0.5, false, 'RightArm');
            addPair(this.leftForeArmBone, getFirstChild(this.leftForeArmBone), 0.5, false, 'LeftArm');

            // 首・頭 (前方に強制スプロール)
            // 首が折れすぎないように重みを大きく下げる
            addPair(this.neckBone, this.headBone, 0.2, false, 'Head');
            addPair(this.headBone, getFirstChild(this.headBone), 0.2, false, 'Head');

            // 背骨 (スプロールなし)
            // 腰から背中もグニャリと曲がりすぎないようにする
            addPair(this.spineBone, this.spine1Bone, 0.1, true, 'Spine');
            addPair(this.spine1Bone, this.spine2Bone, 0.1, true, 'Spine');
            addPair(this.spine2Bone, this.neckBone, 0.1, true, 'Spine');

            // 脚 (外側・後方に強制スプロール)
            // 膝や股関節が極端に曲がりすぎないようにする
            addPair(this.leftUpLegBone, this.leftLegBone, 0.3, true, 'LeftLeg');
            addPair(this.rightUpLegBone, this.rightLegBone, 0.3, true, 'RightLeg');
            addPair(this.leftLegBone, getFirstChild(this.leftLegBone), 0.4, true, 'LeftLeg');
            addPair(this.rightLegBone, getFirstChild(this.rightLegBone), 0.4, true, 'RightLeg');

            this.mesh.updateMatrixWorld(true);
        }

        this.mesh.updateMatrixWorld(true);

        const gravityDir = new THREE.Vector3(0, -1, 0);
        const floorY = 0.25; // カプセルボディ自体の沈み込みを考慮し、床の判定を少し高めに設定

        for (const pair of this.ragdollPairs) {
            const { parent, child, restDir, weight, isLeg, sprawlDir, tag } = pair;

            // 腰と脚はカプセルが倒れ始める段階で少し遅れて、より早く・自然な速さで脱力する
            // 腕(isLeg=false)は 0秒～0.2秒 で一気に脱力
            // 腰・脚(isLeg=true)は 0.05秒～0.5秒 (0.45秒間) かけて素速く脱力
            let t = 0;
            if (isLeg) {
                if (this.ragdollTime < 0.05) continue;
                t = Math.max(0, (this.ragdollTime - 0.05) / 0.45);
            } else {
                t = Math.max(0, this.ragdollTime / 0.2);
            }

            const ease = 1.0 - Math.pow(1.0 - Math.min(1.0, t), 2);
            const blendWeight = ease * weight;

            const parentWorldPos = new THREE.Vector3();
            parent.getWorldPosition(parentWorldPos);

            const childWorldPos = new THREE.Vector3();
            child.getWorldPosition(childWorldPos);

            const boneLength = Math.max(0.1, parentWorldPos.distanceTo(childWorldPos));

            // 基本の重力（下方向）に外側へ広がる力（Sprawl）を混ぜる
            // 床に近づくにつれて広がる力を増やすことで、大の字などにバラけるようにする
            let effectiveGravity = gravityDir.clone();
            const heightFactor = Math.max(0, 1.0 - (childWorldPos.y / 1.5)); // 高さ1.5m以下で広がり始める
            const spreadStrength = 3.5 * heightFactor * blendWeight;

            if (sprawlDir.lengthSq() > 0) {
                effectiveGravity.add(sprawlDir.clone().multiplyScalar(spreadStrength)).normalize();
            }

            // 現在の先端位置に計算した実効重力を加算
            const gravityForce = 0.05 + blendWeight * 0.1;
            let targetWorldPos = childWorldPos.clone().add(effectiveGravity.multiplyScalar(gravityForce));

            // 長さの維持 Constraint
            let fromParent = targetWorldPos.clone().sub(parentWorldPos);
            if (fromParent.lengthSq() > 0.0001) {
                fromParent.normalize().multiplyScalar(boneLength);
                targetWorldPos.copy(parentWorldPos).add(fromParent);
            }

            // === 床ズレ処理はここでは一旦削除し、後段の四元数計算後に行う ===

            // ワールド空間のターゲットを親空間(Parent's Parent)に変換
            const targetLocalPos = targetWorldPos.clone();
            const parentMatrixInv = new THREE.Matrix4();
            if (parent.parent) {
                parentMatrixInv.copy(parent.parent.matrixWorld).invert();
            } else {
                parentMatrixInv.copy(this.mesh.matrixWorld).invert();
            }
            targetLocalPos.applyMatrix4(parentMatrixInv);

            const parentLocalPos = parent.position.clone();
            const targetDirectionLocal = targetLocalPos.sub(parentLocalPos).normalize();

            if (targetDirectionLocal.lengthSq() > 0.001) {
                // 現在のローカルの骨の向き
                const currentLocalDir = restDir.clone().applyQuaternion(parent.quaternion).normalize();

                let dot = currentLocalDir.dot(targetDirectionLocal);
                let deltaQuat = new THREE.Quaternion();

                if (dot < -0.999) {
                    let axis = new THREE.Vector3(1, 0, 0);
                    if (Math.abs(currentLocalDir.x) > 0.9) axis.set(0, 1, 0);
                    axis.cross(currentLocalDir).normalize();
                    deltaQuat.setFromAxisAngle(axis, Math.PI);
                } else {
                    deltaQuat.setFromUnitVectors(currentLocalDir, targetDirectionLocal);
                }

                // 現在の回転（Roll等を含む）に差分を上乗せする
                let targetQuat = deltaQuat.multiply(parent.quaternion);

                // --- Angular Constraint (Joint Limits) ---
                // 各ボーンが死亡時の姿勢（オリジナル）から過剰に曲がらないようにする
                const originalLocalQuat = this.ragdollOriginalBones[parent.name];
                if (originalLocalQuat) {
                    const angle = originalLocalQuat.angleTo(targetQuat);

                    // 部位ごとに最大許容角度（ラジアン）を設定
                    let maxAngle = Math.PI / 4; // デフォルト45度
                    if (tag.includes('Spine') || tag.includes('Head')) {
                        maxAngle = 0; // 首や背骨は全く曲がらないように完全固定
                    } else if (tag.includes('Leg')) {
                        maxAngle = Math.PI / 6;  // 脚（膝・股関節）は 30度 まで
                    } else if (tag.includes('Arm')) {
                        maxAngle = Math.PI / 3;  // 腕・肘は 60度 まで
                    }

                    if (angle > maxAngle) {
                        targetQuat = originalLocalQuat.clone().slerp(targetQuat, maxAngle / angle);
                    }
                }
                // -----------------------------------------

                // 増強したダンピング係数（フレーム落ち時に100%になって暴れるのを防ぐため safeDelta を使用）
                const damping = 1.0 - Math.exp(-40.0 * safeDelta);
                parent.quaternion.slerp(targetQuat, damping * blendWeight);

                // 行列更新して現在位置を仮確認
                parent.updateMatrixWorld(true);

                // === 床抜け防止（Floor Collision Override）===
                const testChildWorldPos = new THREE.Vector3();
                child.getWorldPosition(testChildWorldPos);

                // 首や背骨が個別に床避けで回転すると角度制限（0度）を破壊して首が後ろに折れるため除外
                if (tag.includes('Spine') || tag.includes('Head')) {
                    continue;
                }

                // 頭以外の部位（手足）はそのまま床抜け防止を行う
                let targetFloorY = floorY;

                if (testChildWorldPos.y < targetFloorY) {
                    // もし制限や重力の結果、床下にめり込んでしまった場合、
                    // 強制的に上方向へ回転を補正する
                    const currentParentWorldPos = new THREE.Vector3();
                    parent.getWorldPosition(currentParentWorldPos);

                    let correctedTarget = testChildWorldPos.clone();
                    correctedTarget.y = targetFloorY; // 床の高さに戻す

                    let currentDirWorld = testChildWorldPos.clone().sub(currentParentWorldPos).normalize();
                    let adjustDirWorld = correctedTarget.sub(currentParentWorldPos).normalize();

                    // ワールド空間での補正回転
                    let floorDeltaQuat = new THREE.Quaternion().setFromUnitVectors(currentDirWorld, adjustDirWorld);

                    // ワールド空間のDeltaQuatをローカル空間のDeltaQuatに変換
                    // LocalDelta = ParentWorldInv * WorldDelta * ParentWorld
                    let parentWorldRot = new THREE.Quaternion();
                    if (parent.parent) {
                        parent.parent.getWorldQuaternion(parentWorldRot);
                    } else {
                        this.mesh.getWorldQuaternion(parentWorldRot);
                    }
                    let parentWorldRotInv = parentWorldRot.clone().invert();

                    let localDeltaQuat = parentWorldRotInv.multiply(floorDeltaQuat).multiply(parentWorldRot);

                    // その補正を親ボーンに適用する
                    parent.quaternion.premultiply(localDeltaQuat);
                    parent.updateMatrixWorld(true);
                }
            }
        }
    }

    autoLoadModels() {
        // Automatically load models from /models/ directory
        // loadFBX creates the mixer AND loads shoot.FBX internally,
        // then onComplete loads idle animation and texture
        this.loadFBX('/models/run.FBX', () => {
            console.log('Auto-load: Main model loaded, loading additional assets...');
            // Load separate Idle animation (run.FBX only has run anim)
            // 2) Load Animations via external files
            this.loadExternalAnimation('/models/idle.FBX', 'Idle');
            this.loadExternalAnimation('/models/walk.FBX', 'Walk');
            // run.FBX already loaded as base, but this ensures 'Run' clip is linked
            this.loadExternalAnimation('/models/run.FBX', 'Run');

            // Load Shooting Animation (Upper body only)
            this.loadExternalAnimation('/models/shoot.FBX', 'Shoot', (clip) => {
                return this.createUpperBodyClip(clip, 'Shoot');
            });

            // Load Hit Reaction Animation (Upper body only)
            this.loadExternalAnimation('/models/HitReaction.FBX', 'Hit', (clip) => {
                return this.createUpperBodyClip(clip, 'Hit');
            });

            // Load Stun / Get Up Animations
            this.loadExternalAnimation('/models/GettingUpFromBack_Anim.FBX', 'StandUpBack', undefined);
            this.loadExternalAnimation('/models/StandingUpFromFront_Anim.FBX', 'StandUpFront', undefined);

            // Optional: Pre-load jump/death if available. (We use ragdoll for death mostly)
            // Set Default
            this.setAnimationAction('Idle');
            // Texture
            this.applyTexture('/models/skelton999.TGA');
        });
    }

    getSpawnPosition() {
        // Map center open area is at roughly X=25, Z=25
        // Add random offset between -2 and +2 to prevent multiplayer overlap in the center
        const offset = 4;
        const x = 25.0 + (Math.random() - 0.5) * offset;
        const z = 25.0 + (Math.random() - 0.5) * offset;
        return { x, z };
    }

    getPosition() {
        return this.isLocal ? this.pivot.position : this.mesh.position;
    }

    init() {
        if (this.isLocal) {
            // Local player setup
            this.game.scene.add(this.pivot); // Pivot moves in the world

            const spawnPos = this.getSpawnPosition();
            this.pivot.position.set(spawnPos.x, 1.6, spawnPos.z); // Initial eye height roughly

            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            this.pivot.add(this.camera); // Camera is child of pivot

            // Apply correct initial camera offset depending on view mode
            if (this.isThirdPerson) {
                this.camera.position.set(0.4, 0.6, 3.0);
            } else {
                this.camera.position.set(0, 0, 0);
            }

            // Controls rotate/move the PIVOT, not the camera directly
            this.controls = new PointerLockControls(this.pivot, document.body);

            // Add weapon placeholder (Gun) - attached to camera so it follows view
            const gunGeo = new THREE.BoxGeometry(0.1, 0.1, 0.5);
            const gunMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
            this.gun = new THREE.Mesh(gunGeo, gunMat);
            this.gun.position.set(0.2, -0.1, -0.3);
            this.gun.visible = !this.isThirdPerson; // Hide in TPS initially
            this.camera.add(this.gun);

            // Flashlight - attached to camera
            const flashlight = new THREE.SpotLight(0xffffff, 1, 30, Math.PI / 6, 0.5, 1);
            flashlight.position.set(0, 0, 0);
            flashlight.target.position.set(0, 0, -1);
            this.camera.add(flashlight);
            this.camera.add(flashlight.target);

            // Add Default Placeholder for Local Player (so TPS sees something)
            this.createPlaceholderModel();
            this.game.scene.add(this.mesh);
            this.mesh.visible = this.isThirdPerson; // Show in TPS, Hide in FPS

            // Transform Controls (Gizmo)
            this.transformControl = new TransformControls(this.camera, this.game.renderer.domElement);
            this.transformControl.addEventListener('dragging-changed', (event) => {
                this.controls.enabled = !event.value;
            });
            this.game.scene.add(this.transformControl);
            this.transformControl.visible = false;
            this.transformControl.enabled = false;
            this.transformControl.enabled = false;
            this.gizmoActive = false;


            // Custom Mouse Look for Gizmo Mode (Right Click Drag)
            // Use PointerLock to allow infinite rotation without hitting screen edges
            document.addEventListener('mousedown', (event) => {
                if (this.gizmoActive && event.button === 2) { // Right Click
                    this.controls.lock();
                }
            });

            document.addEventListener('mouseup', (event) => {
                if (this.gizmoActive && event.button === 2) {
                    this.controls.unlock();
                }
            });

            // Note: Standard PointerLockControls handles rotation (Pitch/Yaw) perfectly.
            // We just need to ensure WASD movement is blocked in handleMovement.

        } else {
            // Remote player setup
            this.createPlaceholderModel();
            this.game.scene.add(this.mesh);

            // Create 3D floating health bar above remote player
            this.createHealthBar();
        }
    }

    toggleView() {
        if (!this.isLocal) return;
        this.isThirdPerson = !this.isThirdPerson;

        console.log('View Toggled. Third Person:', this.isThirdPerson);

        if (this.isThirdPerson) {
            // TPS: Move camera back, up, and to the RIGHT (Over-the-shoulder)
            // Original: 0.8, 0.5, 2.5
            // UE Reference (Approx): Right=0.4 (40u), Up=0.6 (60u), Back=3.0 (300u)
            this.camera.position.set(0.4, 0.6, 3.0);

            // Note: UE Aiming zooms to 1.5 (150u). Currently implementing Normal state.
            // Slight tilt down to see player better? No, keep aligned for accuracy.
            this.camera.rotation.set(0, 0, 0);

            this.mesh.visible = true; // Show self
            if (this.gun) this.gun.visible = false; // Hide FPS gun
        } else {
            // FPS: Reset to eye
            this.camera.position.set(0, 0, 0);
            this.camera.rotation.set(0, 0, 0); // Align with pivot
            this.mesh.visible = false; // Hide self (simple approach)
            if (this.gun) this.gun.visible = true; // Show FPS gun
        }
    }

    createPlaceholderModel() {
        const geometry = new THREE.BoxGeometry(1, 2, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 1;
        this.mesh.add(mesh);
    }

    loadFBX(url, onComplete) {
        const loader = new FBXLoader();
        loader.load(url, (object) => {
            // Remove previous model if any
            this.mesh.clear();

            console.log('FBX Loaded!', object);
            // Ensure matrix updates
            object.updateMatrixWorld(true);

            // Force visible for debugging even in FPS? 
            // Better: If local, maybe just console log for now.
            // Wait, if it lsLocal, this.mesh.visible is FALSE by default in FPS mode!
            // The user might be in FPS mode and expecting to see it?
            // "赤い箱のままで" -> "It remains a red box".
            // The red box is the placeholder. 
            // If I clear this.mesh, the red box should disappear!
            // If the red box is still there, loadFBX might not have cleared it or failed silently?
            // But wait, createPlaceholderModel adds to this.mesh.
            // this.mesh.clear() should remove the red box.

            // 1. Adjust Scale (2x original)
            const scale = 0.01;
            object.scale.set(scale, scale, scale);

            // 2. Use Wrapper Hierarchy to separate rotations
            // - mesh: Y rotation (yaw) - controlled in handleMovement
            // - modelWrapper: X rotation (stand up) - fixed

            // Clear any existing rotation on FBX logic (clean slate)
            object.rotation.set(0, 0, 0);

            // Create wrapper for stand-up rotation
            this.modelWrapper = new THREE.Group();
            this.modelWrapper.rotation.x = -Math.PI / 2; // Standard -90 deg to stand up Z-up models
            this.modelWrapper.add(object);

            // 3. Auto-Center Height (Feet on Ground)
            this.modelWrapper.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(this.modelWrapper);

            // Shift Y so the lowest point (box.min.y) is at 0
            const yOffset = -box.min.y;
            object.position.y = yOffset;

            // Hide wrapper until animations finish loading so the user doesn't see a static T-pose
            this.modelWrapper.visible = false;

            console.log('FBX Hierarchy Loaded: Wrapper X=-PI/2');

            // 4. Force Gray Material on all meshes + Assign userData.id for Raycaster hit detection
            object.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.frustumCulled = false; // Prevent flickering during ragdoll bone stretches
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x888888,
                        roughness: 0.7,
                        metalness: 0.1,
                        side: THREE.DoubleSide
                    });
                    // CRITICAL: Assign player ID for hit detection
                    child.userData.id = this.id;
                }
            });
            // Also tag the mesh group itself
            this.mesh.userData.id = this.id;

            this.mixer = new THREE.AnimationMixer(object);

            this.animations = {};

            if (object.animations.length > 0) {
                console.log('Loaded Animations:', object.animations.map(c => c.name));

                // Debug: Log bone names to identify upper body spine/chest
                const boneNames = [];
                object.traverse((child) => {
                    if (child.isBone) {
                        boneNames.push(child.name);
                        const name = child.name.toLowerCase();
                        // Cache bones for aiming and ragdoll
                        if ((name.includes('rightarm') || name.includes('right_arm')) && !name.includes('fore')) {
                            this.rightArmBone = child;
                        }
                        if ((name.includes('leftarm') || name.includes('left_arm')) && !name.includes('fore')) {
                            this.leftArmBone = child;
                        }
                        if (name.includes('rightforearm') || name.includes('right_forearm')) {
                            this.rightForeArmBone = child;
                        }
                        if (name.includes('leftforearm') || name.includes('left_forearm')) {
                            this.leftForeArmBone = child;
                        }
                        // Spine bones (cache multiple levels)
                        if (name === 'spine' || name === 'mixamorig:spine') {
                            this.spineBone = child;
                        }
                        if (name.includes('spine1') || name.includes('spine_1')) {
                            this.spine1Bone = child;
                        }
                        if (name.includes('spine2') || name.includes('spine_2')) {
                            this.spine2Bone = child;
                        }
                        if (name.includes('hips')) {
                            this.hipsBone = child;
                        }
                        if (name.includes('head') && !name.includes('headtop') && !name.includes('head_top')) {
                            this.headBone = child;
                        }
                        if (name.includes('neck')) {
                            this.neckBone = child;
                        }
                        // Leg bones for knee buckling
                        if (name.includes('leftupleg') || name.includes('left_upleg') || name.includes('leftthigh')) {
                            this.leftUpLegBone = child;
                        }
                        if (name.includes('rightupleg') || name.includes('right_upleg') || name.includes('rightthigh')) {
                            this.rightUpLegBone = child;
                        }
                        if ((name.includes('leftleg') || name.includes('left_leg') || name.includes('leftshin')) && !name.includes('upleg')) {
                            this.leftLegBone = child;
                        }
                        if ((name.includes('rightleg') || name.includes('right_leg') || name.includes('rightshin')) && !name.includes('upleg')) {
                            this.rightLegBone = child;
                        }
                    }
                });
                console.log('Model Bones:', boneNames);

                object.animations.forEach((clip) => {
                    this.animations[clip.name] = this.mixer.clipAction(clip);
                });

                const idleClip = object.animations.find(c => c.name.toLowerCase().includes('idle')) || object.animations[0];
                let runClip = object.animations.find(c => c.name.toLowerCase().includes('run') || c.name.toLowerCase().includes('walk'));

                // Fallback: If no Run clip identified, but we have animations, use the default one as Run
                if (!runClip && object.animations.length > 0) {
                    runClip = object.animations[0];
                    console.log('No specific Run animation found, using default:', runClip.name);
                }

                // FILTER RUN CLIP: Remove Right Arm tracks to stop swaying
                if (runClip) {
                    const armKeywords = ['rightarm', 'rightforearm', 'righthand', 'right_arm', 'right_forearm', 'right_hand'];
                    runClip.tracks = runClip.tracks.filter(track => {
                        const lowerName = track.name.toLowerCase();
                        // Keep track ONLY if it does NOT contain arm keywords
                        return !armKeywords.some(k => lowerName.includes(k));
                    });
                    console.log('Filtered Right Arm from Run clip');
                }

                const shootClip = object.animations.find(c => c.name.toLowerCase().includes('shoot') || c.name.toLowerCase().includes('fire') || c.name.toLowerCase().includes('attack'));

                // Always register Idle if it exists
                if (idleClip) {
                    this.animations['Idle'] = this.mixer.clipAction(idleClip);
                }
                if (runClip) {
                    const runAction = this.mixer.clipAction(runClip);
                    runAction.loop = THREE.LoopRepeat;
                    runAction.timeScale = 0.5;
                    runAction.play(); // Ensure it starts playing
                    this.animations['Run'] = runAction;

                    // Create Run_Legs (Lower Body Only) for mixing with Shoot
                    const runLegsClip = this.createSubClip(runClip, 'Run_Legs', true);
                    if (runLegsClip) {
                        const action = this.mixer.clipAction(runLegsClip);
                        action.loop = THREE.LoopRepeat;
                        action.timeScale = 0.5;
                        action.setEffectiveWeight(0); // Start hidden
                        action.play();
                        this.animations['Run_Legs'] = action;
                    }
                } else {
                    this.animations['Run'] = this.animations['Idle'];
                }

                // Removed conflicting 'finished' event listener.
                // Animation logic is now handled by updateAnimationWeights.

                if (shootClip) {
                    // Create Masked Clip for Upper Body (Spine and above)
                    // Hips and Legs are excluded to allow running while shooting
                    const tracks = [];
                    shootClip.tracks.forEach((track) => {
                        const boneName = track.name.split('.')[0];
                        const lowerBoneName = boneName.toLowerCase();

                        // Allow List Approach for Internal Shoot Clip
                        const allowKeywords = [
                            'spine', 'chest', 'neck', 'head',
                            'shoulder', 'collar', 'arm', 'hand', 'finger', 'thumb', 'index', 'middle', 'ring', 'pinky'
                        ];

                        const isUpperBody = allowKeywords.some(keyword => lowerBoneName.includes(keyword));

                        if (isUpperBody) {
                            tracks.push(track);
                        }
                    });

                    if (tracks.length > 0) {
                        const upperBodyClip = new THREE.AnimationClip(shootClip.name + '_Upper', shootClip.duration, tracks);
                        const shootAction = this.mixer.clipAction(upperBodyClip);
                        shootAction.setLoop(THREE.LoopOnce); // Shoot once
                        shootAction.clampWhenFinished = false; // Return to idle/run
                        this.animations['Shoot'] = shootAction;
                        console.log('Created Upper Body Shoot Clip with', tracks.length, 'tracks');
                    } else {
                        console.warn('Could not create upper body clip - no tracks found after filtering');
                        // Fallback to full body shoot if filtering failed
                        const shootAction = this.mixer.clipAction(shootClip);
                        shootAction.setLoop(THREE.LoopOnce);
                        this.animations['Shoot'] = shootAction;
                    }
                } else {
                    console.log('No Shoot animation found');
                }

                if (runClip) {
                    this.createLegsClip(runClip, 'Run');
                }

                // Start with the best available animation
                const startAction = this.animations['Idle'] || this.animations['Run'];
                if (startAction) {
                    startAction.play();
                    this.currentAction = this.animations['Idle'] ? 'Idle' : 'Run';
                    console.log('Initial action:', this.currentAction);
                }
            }

            // Add the wrapper to mesh (Restoring Wrapper Hierarchy)
            this.mesh.add(this.modelWrapper);

            // Restore Shoot Animation Loading
            this.loadExternalAnimation('/models/shoot.FBX', 'Shoot', (clip) => {
                // 1. Create Upper Body version for Running
                // createUpperBodyClip creates a clip named "Shoot_Upper"
                const upperClip = this.createUpperBodyClip(clip, 'Shoot');
                const upperAction = this.mixer.clipAction(upperClip);
                upperAction.setLoop(THREE.LoopOnce);
                upperAction.clampWhenFinished = true;
                this.animations['Shoot_Upper'] = upperAction;

                // 2. Return original clip for 'Shoot' (Full Body) for Standing
                return clip;
            });

            // Load Weapon (Rifle)
            this.loadWeapon();

            // Restore Health Bar if it was cleared by mesh.clear()
            if (this.healthBarSprite) {
                this.mesh.add(this.healthBarSprite);
            }

            // Call onComplete callback if provided (for auto-load chaining)
            if (onComplete) onComplete();

        }, undefined, (error) => {
            console.error('An error happened loading FBX', error);
        });
    }

    // loadDefaultAssets removed to revert to manual loading flow

    createLegsClip(sourceClip, newNamePrefix) {
        const legTracks = [];
        sourceClip.tracks.forEach((track) => {
            const boneName = track.name.split('.')[0];
            const lowerBoneName = boneName.toLowerCase();

            const allowKeywords = [
                'spine', 'chest', 'neck', 'head',
                'shoulder', 'collar', 'arm', 'hand', 'finger', 'thumb', 'index', 'middle', 'ring', 'pinky'
            ];
            // If NOT upper body, it must be lower body (or root/props)
            const isUpperBody = allowKeywords.some(keyword => lowerBoneName.includes(keyword));

            if (!isUpperBody) {
                legTracks.push(track);
            }
        });

        if (legTracks.length > 0) {
            const clipName = newNamePrefix + '_Legs';
            const legsClip = new THREE.AnimationClip(clipName, sourceClip.duration, legTracks);
            const action = this.mixer.clipAction(legsClip);
            action.setEffectiveWeight(0);
            action.play();
            this.animations[clipName] = action;
            console.log(`Created ${clipName} with ${legTracks.length} tracks from ${sourceClip.name}`);
        }
    }

    createUpperBodyClip(clip, namePrefix) {
        const tracks = [];
        clip.tracks.forEach((track) => {
            const boneName = track.name.split('.')[0];
            const lowerBoneName = boneName.toLowerCase();
            const allowKeywords = [
                'spine', 'chest', 'neck', 'head',
                'shoulder', 'collar', 'arm', 'hand', 'finger', 'thumb', 'index', 'middle', 'ring', 'pinky'
            ];
            const isUpperBody = allowKeywords.some(keyword => lowerBoneName.includes(keyword));

            if (isUpperBody) {
                tracks.push(track);
            }
        });

        if (tracks.length > 0) {
            console.log(`Created ${namePrefix}_Upper with ${tracks.length} tracks.`);
            return new THREE.AnimationClip(namePrefix + '_Upper', clip.duration, tracks);
        }
        return clip;
    }

    // Helper to load external animation file and add to current mixer
    loadExternalAnimation(url, name, processClip, retryAltUrl = null) {
        if (!this.mixer) return;

        const fullUrl = url.startsWith('/') ? window.location.origin + url : url;

        const loader = new FBXLoader();
        loader.load(fullUrl, (object) => {
            if (object.animations.length > 0) {
                let clip = object.animations[0];

                if (processClip) {
                    clip = processClip(clip);
                }

                // Stop and clean up old action if it exists
                const oldAction = this.animations[name];
                if (oldAction) {
                    oldAction.stop();
                    console.log(`Stopped old ${name} action before replacement`);
                }

                const action = this.mixer.clipAction(clip);

                // Set loop mode based on animation type
                const isOneShot = (name === 'Shoot' || name.toLowerCase().includes('shoot') ||
                    name.toLowerCase().includes('fire') || name.toLowerCase().includes('attack'));
                const isHit = name.toLowerCase().includes('hit');
                const isStandUp = name.toLowerCase().includes('standup'); // For new stun animations

                if (isOneShot || isHit || isStandUp) {
                    action.setLoop(THREE.LoopOnce);
                    if (isOneShot) action.clampWhenFinished = true; // Hold pose after shooting, but hits should finish cleanly
                } else {
                    action.setLoop(THREE.LoopRepeat);
                }

                this.animations[name] = action;
                console.log(`Loaded external animation: ${name} from ${fullUrl}`);

                // Auto-generate Lower Body clips for Run and Idle
                if (name === 'Idle' || name === 'Run') {
                    this.createLegsClip(clip, name);
                }

                // If replacing the currently active action, auto-switch to the new one
                if (name === this.currentAction) {
                    action.reset().fadeIn(0.3).play();
                    console.log(`Auto-switched to new ${name} animation`);
                    // Ensure the model is visible now that it has an animation pose!
                    if (this.modelWrapper) {
                        this.modelWrapper.visible = true;
                    }
                }
            }
        }, undefined, (err) => {
            console.warn(`External animation file ${fullUrl} not found or failed to load.`);
            if (retryAltUrl) {
                this.loadExternalAnimation(retryAltUrl, name, processClip, null);
            }
        });
    }

    loadWeapon() {
        if (!this.mesh) {
            console.error('loadWeapon: Player mesh mesh not ready');
            return;
        }
        console.log('loadWeapon: Starting load for /models/rifle.FBX');
        const loader = new FBXLoader();
        loader.load('/models/rifle.FBX', (object) => {
            console.log('loadWeapon: File loaded successfully');
            const scale = 1.0;
            object.scale.set(scale, scale, scale);

            // Fix Texture / Material
            object.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x333333, // Dark Gray
                        metalness: 0.8,
                        roughness: 0.2
                    });
                    // Assign player ID for hit detection
                    child.userData.id = this.id;
                }
            });

            // Find Right Hand Bone and Spine Bone (for sling)
            let handBone = null;
            let slungBone = null;
            const boneNames = [];

            this.mesh.traverse((child) => {
                if (child.isBone) {
                    const name = child.name.toLowerCase();
                    boneNames.push(child.name);

                    // Comprehensive Hand Bone Search
                    if (!handBone && (
                        name.includes('righthand') ||
                        name.includes('right_hand') ||
                        name.includes('hand_r') ||
                        name.includes('hand.r') ||
                        name.includes('handr') ||
                        name.includes('hand') && name.includes('r') || // Loose match for R_Hand, Hand_R
                        name.includes('mixamorig:righthand') ||
                        name.includes('valvebiped.bip01_r_hand')
                    )) {
                        handBone = child;
                    }

                    // Comprehensive Spine Bone Search
                    if (!slungBone && (
                        name === 'spine1' ||
                        name === 'spine01' ||
                        name === 'spine_01' ||
                        name === 'spine' ||
                        name.includes('spine') || // Loose match
                        name.includes('back')
                    )) {
                        slungBone = child;
                    }
                }
            });

            if (!handBone) {
                console.warn('RightHand bone not found. Available bones:', boneNames.join(', '));
            }

            // Store bones for update logic
            this.handBone = handBone;
            this.slungBone = slungBone;

            if (handBone) {
                // Default to Slung state (on back) initially?
                // Or Hand state? The game starts with aiming usually.
                // Let's start with Hand for safety, update() will switch it if needed.
                handBone.add(object);
                this.weapon = object;

                // --- A. Synchronous Load from LocalStorage (Instant) ---
                try {
                    const savedData = localStorage.getItem('doom_weapon_transform');
                    if (savedData) {
                        const parsed = JSON.parse(savedData);
                        if (parsed.pos && parsed.rot) this.aimingTransform = parsed;
                    }
                } catch (e) { console.error('LocalStorage Aiming Load Error:', e); }

                // Default Aiming Transform
                // --- A. Synchronous Local Load (Immediate) ---
                const savedTransform = localStorage.getItem('doom_weapon_transform');
                if (savedTransform) {
                    try {
                        this.aimingTransform = JSON.parse(savedTransform);
                    } catch (e) {
                        console.error('Failed to parse local weapon transform', e);
                        // Fallback to Hardcoded Defaults (Updated from User's Config)
                        this.aimingTransform = {
                            pos: { x: 10.25, y: -0.10, z: 1.60 },
                            rot: { x: 28.05, y: 9.30, z: -4.74 }
                        };
                    }
                } else {
                    // Default to Hardcoded Values if nothing locally (Updated from User's Config)
                    this.aimingTransform = {
                        pos: { x: 10.25, y: -0.10, z: 1.60 },
                        rot: { x: 28.05, y: 9.30, z: -4.74 }
                    };
                }

                this.slungTransform = {
                    pos: { x: -11.65, y: 27.10, z: -28.80 },
                    rot: { x: 39.45, y: 8.60, z: -8.14 } // Updated from User's Config
                };

                // Apply Initial State Immediately
                const initialTarget = this.aimingTransform;
                if (this.weapon) {
                    this.weapon.position.set(initialTarget.pos.x, initialTarget.pos.y, initialTarget.pos.z);
                    this.weapon.rotation.set(initialTarget.rot.x, initialTarget.rot.y, initialTarget.rot.z);
                }

                // --- B. Asynchronous Server Load (Background Update) ---
                fetch('/api/get-weapon-config')
                    .then(res => res.json())
                    .then(config => {
                        console.log('Loaded Weapon Config from Server:', config);
                        let updated = false;

                        if (config.aiming && config.aiming.pos && config.aiming.rot) {
                            this.aimingTransform = config.aiming;
                            localStorage.setItem('doom_weapon_transform', JSON.stringify(config.aiming));
                            updated = true;
                        }
                        if (config.slung && config.slung.pos && config.slung.rot) {
                            this.slungTransform = config.slung;
                            localStorage.setItem('doom_weapon_slung_transform', JSON.stringify(config.slung));
                            updated = true;
                        }

                        // If we are currently in a state that was updated, re-apply it
                        if (updated && !this.isFiring && this.weapon) {
                            // Assuming we start in Slung/Idle or Hand/Aiming based on game state
                            // verification step will confirm visual usage
                        }
                    })
                    .catch(err => {
                        console.warn('Server config load skipped/failed:', err);
                    });

                console.log('Weapon attached to BONE:', handBone.name);
            } else {
                console.warn('RightHand bone not found, attaching to mesh ROOT as fallback');
                this.mesh.add(object);
                object.position.y = 2.0; // Force visible high up
                this.weapon = object;
            }

        }, undefined, (error) => {
            console.error('Error loading rifle.FBX:', error);
        });
    }

    update(delta, walls, isFiring = false) {
        // Skip all updates while dead (PhysicsManager controls mesh position)
        if (this.isDead) return;

        this.isFiring = isFiring; // Store for debug display

        // Weapon Slinging Logic (Switch between Hand and Back)
        // Disable switching while Gizmo is active to prevent jumps
        if (this.isLocal && this.weapon && !this.gizmoActive) {
            const targetParent = isFiring ? (this.handBone || this.mesh) : (this.slungBone || this.mesh);

            if (this.weapon.parent !== targetParent) {
                targetParent.add(this.weapon);
                console.log(`Switched Weapon to: ${targetParent.name || 'MESH'}`);
            }
        }

        if (this.isLocal) {
            this.handleMovement(delta, walls, isFiring);
        } else {
            // Remote Player: Visual Sync Only
            this.syncVisuals(delta, this.isFiring);
        }

        // --- Post-Movement Animation & Pose Update ---
        if (this.mixer) {
            this.mixer.update(delta);

            // 1. SYNC WEAPON TRANSFORM (Enforce offsets every frame to fight animation overrides)
            if (this.isLocal && this.weapon && !this.gizmoActive) {
                const target = (this.isFiring) ? this.aimingTransform : this.slungTransform;
                if (target && target.pos && target.rot) {
                    this.weapon.position.set(target.pos.x, target.pos.y, target.pos.z);
                    this.weapon.rotation.set(target.rot.x, target.rot.y, target.rot.z);
                } else if (!this.isFiring) {
                    // Force Default Slung if not set (Prevents floating shoot position on back)
                    this.weapon.position.set(0.15, 0.2, 0.15);
                    this.weapon.rotation.set(0, 0, Math.PI / 1.25);
                }
            }

            // 2. CONDITIONAL STABILIZATION & AIM OFFSET
            if (this.isLocal && this.slungBone && this.mesh && this.isFiring && this.camera && !this.gizmoActive) {
                // Stabilize Spine relative to CAMERA direction, not Mesh direction.

                const cameraQuat = new THREE.Quaternion();
                this.camera.getWorldQuaternion(cameraQuat);

                // Rig Correction: Add 180-degree rotation if the upper body faces backwards
                const correctionQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

                // Lean Forward Arch (0.5 rad)
                const archQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);

                // Combine: Camera Orientation -> 180 Correction -> Forward Lean
                const targetWorldQuat = cameraQuat.clone().multiply(correctionQuat).multiply(archQuat);

                const parentWorldQuat = new THREE.Quaternion();
                if (this.slungBone.parent) {
                    this.slungBone.parent.getWorldQuaternion(parentWorldQuat);
                } else {
                    parentWorldQuat.copy(this.mesh.quaternion);
                }
                const localQuat = parentWorldQuat.invert().multiply(targetWorldQuat);

                this.slungBone.quaternion.copy(localQuat);
                this.slungBone.updateMatrix();
                this.slungBone.updateMatrixWorld();
            }

            // --- REMOTE PLAYER SPINE TWIST & PITCH ---
            if (!this.isLocal && this.spineBone) {
                // 1. PITCH (Look Up/Down) - Always apply latest known pitch
                if (typeof this.remotePitch === 'number') {
                    // Note: Sign depends on model rigging. Usually minus for "Look Up"
                    this.spineBone.rotation.x -= this.remotePitch;
                }

                // Force update
                this.spineBone.updateMatrix();
            }
        }
    }

    handleMovement(delta, walls, isFiring) {
        if (!this.isLocal) return;
        if (this.isDead || this.isStunned) {
            // Stop all movement and shooting when stunned or dead
            this.velocity.set(0, 0, 0);
            this.moveForward = this.moveBackward = this.moveLeft = this.moveRight = false;
            return;
        }

        // Gizmo overrides movement/aiming entirely!
        if (this.transformControl && this.transformControl.dragging) {
            return;
        }

        // Global Debug Key (P) - Export Config
        if (this.game.keys && this.game.keys['KeyP'] && !this.pKeyDebounce) {
            this.pKeyDebounce = true;
            console.log('--- Exporting Weapon Config ---');

            const exportData = {
                aiming: this.aimingTransform || {
                    pos: this.weapon.position.clone(),
                    rot: this.weapon.rotation.clone()
                },
                slung: this.slungTransform || {
                    pos: { x: 0.15, y: 0.2, z: 0.15 },
                    rot: { x: 0, y: 0, z: Math.PI / 1.25 }
                }
            };

            // Update current values from weapon if valid
            if (this.weapon) {
                const current = {
                    pos: { x: this.weapon.position.x, y: this.weapon.position.y, z: this.weapon.position.z },
                    rot: { x: this.weapon.rotation.x, y: this.weapon.rotation.y, z: this.weapon.rotation.z }
                };
                if (this.isFiring) exportData.aiming = current;
                else exportData.slung = current;
            }

            const jsonString = JSON.stringify(exportData, null, 2);
            console.log(jsonString);

            // Send to Server (Restored)
            fetch('/api/save-weapon-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: jsonString
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        alert("Weapon configuration SAVED to server (Shared for all users)!");
                    } else {
                        alert("Failed to save config: " + data.error);
                    }
                })
                .catch(err => {
                    console.error("Save error:", err);
                    alert("Network error saving config.");
                });

            setTimeout(() => this.pKeyDebounce = false, 1000);
        }

        // Toggle Freeze Pose (T)
        if (this.game.keys && this.game.keys['KeyT']) {
            console.log('T Key Detected. Animations[Shoot]:', !!this.animations['Shoot']);
            if (!this.tKeyPressed) {
                this.debugFreeze = !this.debugFreeze;
                console.log('Debug Freeze:', this.debugFreeze);
                if (this.debugFreeze) {
                    if (this.animations['Shoot']) this.animations['Shoot'].paused = true;
                } else {
                    if (this.animations['Shoot']) {
                        this.animations['Shoot'].paused = false;
                        this.animations['Shoot'].play();
                    }
                }
                this.tKeyPressed = true;
            }
        } else {
            this.tKeyPressed = false;
        }

        // Toggle Gizmo (G)
        if (this.game.keys && this.game.keys['KeyG']) {
            if (!this.gKeyPressed) {
                this.gizmoActive = !this.gizmoActive;

                if (this.gizmoActive) {
                    // Activate Gizmo + Freeze in Shoot Pose
                    if (this.weapon) {
                        try {
                            if (!this.transformControl.parent) {
                                this.game.scene.add(this.transformControl);
                            }
                        } catch (e) {
                            console.error('Error adding Gizmo to scene:', e);
                        }

                        document.exitPointerLock();
                        this.transformControl.attach(this.weapon);
                        this.transformControl.visible = true;
                        this.transformControl.enabled = true;
                        this.transformControl.setMode('translate');
                        console.log('Gizmo ON: Translate Mode. Animation FROZEN.');

                        // FORCE POSE BASED ON STATE
                        if (this.slungBone && this.weapon.parent === this.slungBone) {
                            // Slung Mode: Force IDLE (Arms down) so we can see the back
                            if (this.animations['Idle']) {
                                this.animations['Idle'].reset().play();
                                this.animations['Idle'].paused = true;
                                this.animations['Idle'].setEffectiveWeight(1.0);
                            }
                            // Ensure Shoot/Run are OFF
                            if (this.animations['Shoot']) this.animations['Shoot'].setEffectiveWeight(0.0);
                            if (this.animations['Run']) this.animations['Run'].setEffectiveWeight(0.0);

                            console.log('Gizmo ON: Slung Mode -> Forced Idle Pose');
                        } else {
                            // Aiming Mode: Force SHOOT POSE
                            if (this.animations['Shoot']) {
                                this.animations['Shoot'].reset().play();
                                this.animations['Shoot'].paused = true;
                                this.animations['Shoot'].setEffectiveWeight(1.0);
                            }
                            if (this.animations['Idle']) this.animations['Idle'].setEffectiveWeight(0);
                            if (this.animations['Run']) this.animations['Run'].setEffectiveWeight(0);

                            console.log('Gizmo ON: Aiming Mode -> Forced Shoot Pose');
                        }

                        this.mixer.timeScale = 0; // Global Freeze

                    } else {
                        console.warn('Cannot activate Gizmo: Weapon not loaded');
                        this.gizmoActive = false;
                    }
                } else {
                    // Deactivate Gizmo + Unfreeze
                    this.controls.lock();
                    this.transformControl.detach();
                    this.transformControl.visible = false;
                    this.transformControl.enabled = false;
                    console.log('Gizmo OFF. Animation Resumed.');

                    this.mixer.timeScale = 1; // Global Unfreeze
                    if (this.animations['Shoot']) this.animations['Shoot'].paused = false;

                    // SAVE ON EXIT
                    if (this.weapon) {
                        const saveData = {
                            pos: { x: this.weapon.position.x, y: this.weapon.position.y, z: this.weapon.position.z },
                            rot: { x: this.weapon.rotation.x, y: this.weapon.rotation.y, z: this.weapon.rotation.z }
                        };

                        // Determine which state to save based on parent
                        if (this.slungBone && this.weapon.parent === this.slungBone) {
                            localStorage.setItem('doom_weapon_slung_transform', JSON.stringify(saveData));
                            this.slungTransform = saveData;
                            console.log('Gizmo Exit: Saved SLUNG transform');
                        } else {
                            // Default to Aiming (Hand)
                            localStorage.setItem('doom_weapon_transform', JSON.stringify(saveData));
                            this.aimingTransform = saveData;
                            console.log('Gizmo Exit: Saved AIMING transform');
                        }
                    }
                }
                this.gKeyPressed = true;
            }
        } else {
            this.gKeyPressed = false;
        }

        // Gizmo Mode Switching
        if (this.gizmoActive && this.game.keys) {
            if (this.game.keys['Digit1']) this.transformControl.setMode('translate');
            if (this.game.keys['Digit2']) this.transformControl.setMode('rotate');
        }




        // Weapon Adjustment Debug (Temp)
        if (this.weapon && this.game.keys) {
            // Determine which transform we are currently editing
            const target = isFiring ? this.aimingTransform : this.slungTransform;

            if (target && target.pos && target.rot) {
                // Rotation Adjustment (Shift + Keys)
                const isShift = this.game.keys['ShiftLeft'] || this.game.keys['ShiftRight'];

                if (isShift) {
                    const rotSpeed = 0.1; // Doubled from 0.05
                    if (this.game.keys['KeyI']) target.rot.x -= rotSpeed;
                    if (this.game.keys['KeyK']) target.rot.x += rotSpeed;
                    if (this.game.keys['KeyJ']) target.rot.y -= rotSpeed;
                    if (this.game.keys['KeyL']) target.rot.y += rotSpeed;
                    if (this.game.keys['KeyU']) target.rot.z += rotSpeed;
                    if (this.game.keys['KeyO']) target.rot.z -= rotSpeed;
                }
                // Position Adjustment (Single Keys)
                else {
                    const speed = 0.1; // Doubled from 0.05
                    if (this.game.keys['KeyI']) target.pos.z -= speed;
                    if (this.game.keys['KeyK']) target.pos.z += speed;
                    if (this.game.keys['KeyJ']) target.pos.x -= speed;
                    if (this.game.keys['KeyL']) target.pos.x += speed;
                    if (this.game.keys['KeyU']) target.pos.y += speed;
                    if (this.game.keys['KeyO']) target.pos.y -= speed;
                }

                // Apply to weapon immediately so sync block doesn't fight it
                this.weapon.position.set(target.pos.x, target.pos.y, target.pos.z);
                this.weapon.rotation.set(target.rot.x, target.rot.y, target.rot.z);

                // Auto-save to localStorage periodically (or on every change here for simplicity)
                const key = isFiring ? 'doom_weapon_transform' : 'doom_weapon_slung_transform';
                localStorage.setItem(key, JSON.stringify(target));
            }
        }

        // Log Values
        // Log Values
        if (this.game.keys && this.game.keys['KeyP']) {
            console.log('Weapon Pos:', this.weapon.position);
            console.log('Weapon Rot:', this.weapon.rotation);
            console.log('Weapon Scale:', this.weapon.scale);
        }


        // Guard movement/input logic with Pointer Lock
        if (!this.controls.isLocked) {
            // Even if unlocked (Gizmo mode), we want the stationary facing logic to work
            this.syncVisuals(delta, isFiring);
            return;
        }

        // Apply damping
        this.velocity.x -= this.velocity.x * 10.0 * delta;
        this.velocity.z -= this.velocity.z * 10.0 * delta;

        this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
        this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
        this.direction.normalize();

        const speed = 110.0; // Increased significantly for faster movement per user request
        if (this.moveForward || this.moveBackward) this.velocity.z -= this.direction.z * speed * delta;
        if (this.moveLeft || this.moveRight) this.velocity.x -= this.direction.x * speed * delta;

        // Apply X movement with Wall Collision
        const startPos = this.pivot.position.clone();
        this.controls.moveRight(-this.velocity.x * delta);
        const playerSphereX = new THREE.Sphere(this.pivot.position.clone(), 0.5);
        for (const wall of walls) {
            wall.geometry.computeBoundingBox();
            if (new THREE.Box3().setFromObject(wall).intersectsSphere(playerSphereX)) {
                this.pivot.position.copy(startPos); // Revert
                this.velocity.x = 0;
                break;
            }
        }

        // Apply Z movement with Wall Collision
        const midPos = this.pivot.position.clone();
        this.controls.moveForward(-this.velocity.z * delta);
        const playerSphereZ = new THREE.Sphere(this.pivot.position.clone(), 0.5);
        for (const wall of walls) {
            wall.geometry.computeBoundingBox();
            if (new THREE.Box3().setFromObject(wall).intersectsSphere(playerSphereZ)) {
                this.pivot.position.copy(midPos); // Revert
                this.velocity.z = 0;
                break;
            }
        }

        this.syncVisuals(delta, isFiring);
    }

    syncVisuals(delta, isFiring) {
        // 1. Calculate isMoving for Remote Player (or local player if this is the main sync)
        // We use the flags set by updateRemoteState for remote players, or local input for local players.
        const isMoving = this.moveForward || this.moveBackward || this.moveLeft || this.moveRight;

        // 2. Update Animations (CRITICAL FIX)
        this.updateAnimationWeights(delta, isMoving, isFiring);

        // For local player, continue with existing visual sync logic
        if (this.isLocal) {
            // Update currentAction for local player
            if (isMoving) {
                this.currentAction = 'Run';
            } else {
                this.currentAction = 'Idle';
            }

            // Sync visual mesh to physics pivot
            this.mesh.position.copy(this.pivot.position);
            this.mesh.position.y -= 1.6;

            // Sync Character Rotation (Yaw)
            // Always update rotation to match camera/movement provided modelWrapper exists
            if (this.modelWrapper) {
                const cameraDir = new THREE.Vector3();
                this.camera.getWorldDirection(cameraDir);
                cameraDir.y = 0;
                cameraDir.normalize();

                const cameraYaw = Math.atan2(cameraDir.x, cameraDir.z);
                let facingOffset = 0;

                // CRITICAL: When firing, ALWAYS face forward (align with camera)
                // Regardless of running direction (Strafing Mode)
                if (isFiring) {
                    facingOffset = 0;
                } else if (isMoving) {
                    // Only follow move direction if NOT firing
                    if (this.moveBackward && !this.moveForward) facingOffset = Math.PI;
                    else if (this.moveLeft && !this.moveRight && !this.moveForward && !this.moveBackward) facingOffset = Math.PI / 2;
                    else if (this.moveRight && !this.moveLeft && !this.moveForward && !this.moveBackward) facingOffset = -Math.PI / 2;
                }

                this.mesh.rotation.y = cameraYaw + facingOffset;
            }

            // Camera Aiming Transitions (TPS only)
            if (this.isThirdPerson) {
                const aiming = isFiring;
                const targetPos = aiming
                    ? new THREE.Vector3(-2.5, 2.5, 4.0)
                    : new THREE.Vector3(0.4, 0.6, 3.0);

                const targetRot = aiming
                    ? new THREE.Euler(-0.3, 0, 0)
                    : new THREE.Euler(0, 0, 0);

                const lerpSpeed = 5.0 * delta;
                this.camera.position.lerp(targetPos, lerpSpeed);

                const targetQuat = new THREE.Quaternion().setFromEuler(targetRot);
                this.camera.quaternion.slerp(targetQuat, lerpSpeed);
            }
        } else {
            // For remote players, position and rotation are set directly by updateRemoteState

            // 3. Sync Weapon Parenting (Hand vs Back)
            if (this.weapon && this.handBone && this.slungBone) {
                // Use helper to include animation window in "isShooting" check
                const isShooting = this.getIsShooting(isFiring);

                const targetParent = isShooting ? this.handBone : this.slungBone;
                if (this.weapon.parent !== targetParent) {
                    targetParent.add(this.weapon);
                }

                // 4. Sync Weapon Transform (Apply Offsets)
                const target = (isShooting) ? this.aimingTransform : this.slungTransform;

                if (target && target.pos && target.rot) {
                    this.weapon.position.set(target.pos.x, target.pos.y, target.pos.z);
                    this.weapon.rotation.set(target.rot.x, target.rot.y, target.rot.z);
                } else if (!isShooting) {
                    // Default Slung Offset if not defined
                    this.weapon.position.set(0.15, 0.2, 0.15);
                    this.weapon.rotation.set(0, 0, Math.PI / 1.25);
                }
            }
        }
    }

    updateRemoteState(state) {
        // If they were dead but their networked health indicates they respawned, force a respawn on the client side
        if (this.isDead && state.health !== undefined && state.health > 0) {
            console.log(`[Player ${this.id}] was dead but received health ${state.health}. Respawning remotely.`);
            this.respawn();
        }

        // Skip positional updates while dead (PhysicsManager controls the limp ragdoll)
        if (this.isDead) return;

        // Called by NetworkManager
        // state: { position, rotation, action, isFiring, pitch }

        // Debug Log (Throttle to avoid spam)
        if (Math.random() < 0.01) {
            console.log(`[Player] Remote Update: RotY=${state.rotation.y.toFixed(2)}, Action=${state.action}, Firing=${state.isFiring}`);
        }

        // 1. Position & Rotation (Base Mesh)
        this.mesh.position.copy(state.position);

        // CRITICAL: Ensure we are applying rotation to the GROUP, not just a child
        // Override rotation during shooting to face aim target (Fixes 45-deg strafing issue)
        const now = performance.now();
        if (this.forcedAimYaw !== undefined && (now - this.forcedAimTime < 500) && state.isFiring) {
            this.mesh.rotation.set(state.rotation.x, this.forcedAimYaw, state.rotation.z);
        } else {
            this.mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
        }

        // 2. Flags for Animation
        this.isFiring = state.isFiring;

        // 3. Pitch for Spine
        this.remotePitch = state.pitch || 0;

        // 4. Movement Detection (Inferred)
        // If 'Run' layout is sent, we trust it.
        if (state.action === 'Run') {
            this.moveForward = true; // Force movement logic to trigger 'Run' weight
        } else {
            this.moveForward = false;
        }
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;

        // 5. Weapon Transform Sync (Custom Aiming Offset)
        if (state.gunPos && state.gunRot) {
            this.aimingTransform = {
                pos: state.gunPos,
                rot: state.gunRot
            };
        }

        // 6. Health Sync (for 3D floating health bar)
        if (typeof state.health === 'number') {
            const oldHealth = this.health;
            this.health = state.health;
            if (typeof state.maxHealth === 'number') this.maxHealth = state.maxHealth;
            if (oldHealth !== this.health) {
                this.drawHealthBar();
            }
        }
    }

    getIsShooting(isFiringInput) {
        // Determine if player is effectively shooting (Input OR Animation Window)
        let isShooting = isFiringInput;

        // Remote Sync: Force true if within one-shot animation window
        if (!isShooting && this.lastShootTime && this.shootDuration) {
            const timeSinceShoot = performance.now() - this.lastShootTime;
            if (timeSinceShoot < this.shootDuration) {
                isShooting = true;
            }
        }
        return isShooting;
    }

    updateAnimationWeights(delta, isMoving, isFiring) {
        if (!this.mixer) return;

        // If Gizmo is active, DO NOT update weights (Keep Shoot Pose Frozen)
        if (this.gizmoActive) return;

        // 1. Determine System State
        const shootAction = this.animations['Shoot'];

        // Use helper to determine effective shooting state
        const isShooting = this.getIsShooting(isFiring);

        // Determine Hit Reaction State (Dynamic based on actual animation duration)
        let isHitFlinching = false;
        if (this.lastHitTime && this.animations['Hit']) {
            const hitClipDurationMs = this.animations['Hit'].getClip().duration * 1000;
            const timeSinceHit = performance.now() - this.lastHitTime;

            // Allow the hit animation to play fully without getting cut off
            if (timeSinceHit < hitClipDurationMs) {
                isHitFlinching = true;
            }
        }

        // Default Targets
        const targets = {
            'Idle': 0,
            'Idle_Legs': 0, // Using the automatically generated Idle lower body
            'Run': 0,
            'Run_Legs': 0,
            'Shoot': 0,
            'Shoot_Upper': 0,
            'Hit': 0
        };

        if (isShooting) {
            if (isMoving) {
                // Moving + Shooting
                targets['Shoot_Upper'] = 1.0;
                targets['Run_Legs'] = 1.0;
            } else {
                // Stopped + Shooting
                targets['Shoot'] = 1.0;
            }
        } else {
            // Not Shooting
            if (isMoving) {
                // Moving Normal
                targets['Run'] = 1.0;
            } else {
                // Stopped Normal
                targets['Idle'] = 1.0;
            }
        }

        // OVERRIDE: If hit, play flinch on upper body but keep legs animating
        if (isHitFlinching) {
            Object.keys(targets).forEach(k => { targets[k] = 0; });
            targets['Hit'] = 1.0;
            // Always keep legs animating during flinch to avoid frozen lower body
            if (isMoving) {
                targets['Run_Legs'] = 1.0;
            } else {
                targets['Idle_Legs'] = 1.0;
            }
        }

        // OVERRIDE: If stunned by lightning, play the stun/standup animation exclusively
        if (this.isStunned && this.currentAction && (this.currentAction === 'StandUpFront' || this.currentAction === 'StandUpBack')) {
            Object.keys(targets).forEach(k => { targets[k] = 0; });
            targets[this.currentAction] = 1.0; // Force the stun animation to 100% weight
        }

        // 2. Apply Weights IMMEDIATELY (Lerp Disabled to prevent T-pose from partial weight)
        // const lerpSpeed = 10.0 * delta;

        Object.keys(this.animations).forEach(name => {
            const action = this.animations[name];
            if (!action) return;

            const target = targets[name] !== undefined ? targets[name] : 0;

            // FORCE Weight to avoid T-pose
            action.setEffectiveWeight(target);

            // Ensure playing if it has weight
            if (target > 0 && !action.isRunning()) {
                if (name === 'StandUpFront' || name === 'StandUpBack') {
                    // Don't forcefully restart stun animations if they are just paused at the end
                    if (action.time === 0 || action.time >= action.getClip().duration) {
                        action.reset().play();
                    } else {
                        action.play();
                    }
                } else {
                    action.play();
                }
            }
        });

        // 3. Sync Run_Legs to Run time
        const runAction = this.animations['Run'];
        const runLegsAction = this.animations['Run_Legs'];
        if (runAction && runLegsAction && runAction.isRunning()) {
            runLegsAction.time = runAction.time;
        }
    }

    // Helper to create a sub-clip by filtering bones
    createSubClip(sourceClip, newName, keepLowerBody) {
        const tracks = [];
        sourceClip.tracks.forEach((track) => {
            const boneName = track.name.split('.')[0];
            const lowerBoneName = boneName.toLowerCase();

            // Identify Lower Body Bones
            const isLowerBody = lowerBoneName.includes('hips') ||
                lowerBoneName.includes('leg') ||
                lowerBoneName.includes('foot') ||
                lowerBoneName.includes('toe');

            const isRoot = lowerBoneName === 'root' || lowerBoneName === 'armature';

            let keep = false;
            if (keepLowerBody) {
                // Keep only lower body and root for movement
                if (isLowerBody || isRoot) keep = true;
            } else {
                // Keep only upper body for actions
                if (!isLowerBody && !isRoot) keep = true;
            }

            if (keep) {
                tracks.push(track);
            }
        });

        if (tracks.length > 0) {
            console.log(`Created sub-clip ${newName} with ${tracks.length} tracks.`);
            return new THREE.AnimationClip(newName, sourceClip.duration, tracks);
        }
        console.warn(`Failed to create sub-clip ${newName}: 0 tracks kept.`);
        return null;
    }

    fadeToAction(name, duration) {
        // Deprecated: Logic moved to updateAnimationWeights
    }

    triggerShootAnimation(direction) {
        // Called by Remote Player Sync to force replay of Shoot
        if (!this.mixer) return;

        // Store Forced Aim Yaw (for mesh rotation override)
        if (direction && !this.isLocal) {
            const flatDir = direction.clone();
            flatDir.y = 0;
            flatDir.normalize();
            this.forcedAimYaw = Math.atan2(flatDir.x, flatDir.z);
            // Compensate for weapon aimingTransform Y rotation offset (~5 degrees)
            // so the gun muzzle visually aligns with the bullet trajectory
            this.forcedAimYaw -= 0.35; // ~20 degrees CW to align gun muzzle with bullet
            this.forcedAimTime = performance.now();
            // Immediately apply the forced rotation
            this.mesh.rotation.y = this.forcedAimYaw;
        }

        // Reset and Play "Shoot" or "Shoot_Upper" depending on what's active/available
        const shootAction = this.animations['Shoot'];
        const shootUpperAction = this.animations['Shoot_Upper'];
        const now = performance.now();

        // Track active action to determine duration
        let activeAction = null;

        if (shootAction) {
            shootAction.reset();
            shootAction.setEffectiveWeight(1.0); // Ensure it's seen
            shootAction.play();
            activeAction = shootAction;
        }
        if (shootUpperAction) {
            shootUpperAction.reset();
            shootUpperAction.setEffectiveWeight(1.0);
            shootUpperAction.play();
            activeAction = shootUpperAction;
        }

        if (activeAction) {
            this.lastShootTime = now;
            this.shootDuration = activeAction.getClip().duration * 1000;
        }
    }


    // Helper to calculate bullet spawn state (Origin & Direction) from current weapon state
    getBulletSpawnState() {
        let origin;
        let direction = new THREE.Vector3();
        let networkOrigin = new THREE.Vector3();

        // FPS Local: Always use camera for reliable shooting regardless of model
        if (this.isLocal && !this.isThirdPerson) {
            origin = this.camera.getWorldPosition(new THREE.Vector3());
            this.camera.getWorldDirection(direction);
            direction.normalize();

            // Calculate network origin from weapon if available (for remote visual)
            if (this.weapon) {
                if (this.handBone && this.weapon.parent !== this.handBone) {
                    this.handBone.add(this.weapon);
                }
                if (this.aimingTransform && this.aimingTransform.pos && this.aimingTransform.rot) {
                    this.weapon.position.set(
                        this.aimingTransform.pos.x,
                        this.aimingTransform.pos.y,
                        this.aimingTransform.pos.z
                    );
                    this.weapon.rotation.set(
                        this.aimingTransform.rot.x,
                        this.aimingTransform.rot.y,
                        this.aimingTransform.rot.z
                    );
                }
                this.mesh.updateMatrixWorld(true);
                this.weapon.getWorldPosition(networkOrigin);
            } else {
                networkOrigin.copy(origin);
            }

            // Offset to prevent self-collision
            origin.add(direction.clone().multiplyScalar(0.5));

            return { origin, direction, networkOrigin };
        }

        // TPS or Remote: Use weapon-based calculation
        if (this.weapon) {
            if (this.handBone && this.weapon.parent !== this.handBone) {
                this.handBone.add(this.weapon);
            }

            if (this.aimingTransform && this.aimingTransform.pos && this.aimingTransform.rot) {
                this.weapon.position.set(
                    this.aimingTransform.pos.x,
                    this.aimingTransform.pos.y,
                    this.aimingTransform.pos.z
                );
                this.weapon.rotation.set(
                    this.aimingTransform.rot.x,
                    this.aimingTransform.rot.y,
                    this.aimingTransform.rot.z
                );
            }

            this.weapon.updateMatrixWorld(true);
            this.weapon.getWorldPosition(networkOrigin);

            const weaponQuat = new THREE.Quaternion();
            this.weapon.getWorldQuaternion(weaponQuat);
            const forwardOffset = new THREE.Vector3(0, -1, 0).applyQuaternion(weaponQuat).multiplyScalar(0.8);
            const upOffset = new THREE.Vector3(0, 0, 1).applyQuaternion(weaponQuat).multiplyScalar(0.10);
            networkOrigin.add(forwardOffset).add(upOffset);

            origin = networkOrigin.clone();
            direction.set(0, -1, 0).applyQuaternion(weaponQuat).normalize();

            origin.add(direction.clone().multiplyScalar(0.5));
            return { origin, direction, networkOrigin };

        } else {
            // Fallback
            if (this.isLocal) {
                origin = this.camera.getWorldPosition(new THREE.Vector3());
                this.camera.getWorldDirection(direction);
            } else {
                origin = this.mesh.position.clone();
                origin.y += 1.5;
                this.mesh.getWorldDirection(direction);
            }
            networkOrigin.copy(origin);
            return { origin, direction, networkOrigin };
        }
    }

    shoot() {
        // Play Animation
        if (this.mixer && this.animations['Shoot']) {
            const shootAction = this.animations['Shoot'];
            shootAction.reset();
            shootAction.setEffectiveWeight(1.0);
            shootAction.setLoop(THREE.LoopOnce);
            shootAction.clampWhenFinished = true;
            shootAction.play();
            console.log('Shooting triggered');
        }

        // Play Sound
        try {
            const snd = new Audio('/models/enemy/RifleA_Fire_ST01.WAV');
            snd.volume = 0.4;
            snd.play().catch(e => console.warn(e));
        } catch (e) {
            console.warn("Audio playback failed:", e);
        }

        return this.getBulletSpawnState();
    }


    setAnimationAction(name) {
        if (name !== this.currentAction) {
            this.fadeToAction(name, 0.2);
            this.currentAction = name;
        }
    }

    getPosition() {
        if (this.isLocal) {
            const pos = this.pivot.position.clone();
            pos.y -= 1.6; // Convert Eye Level to Feet Level for networking
            return pos;
        }
        return this.mesh.position;
    }

    getRotation() {
        if (this.isLocal) {
            // Updated: Since syncVisuals now ALWAYS updates mesh.rotation (even when idle),
            // we can trust mesh.rotation to be the correct visual state, including strafing offsets.
            // MUST RETURN PLAIN OBJECT to avoid THREE.Euler serialization issues (_x vs x)
            return {
                x: this.mesh.rotation.x,
                y: this.mesh.rotation.y,
                z: this.mesh.rotation.z
            };
        }
        return {
            x: this.mesh.rotation.x,
            y: this.mesh.rotation.y,
            z: this.mesh.rotation.z
        };
    }

    applyTexture(url) {
        // Determine loader based on file extension
        const isTGA = url.toLowerCase().includes('.tga') || url.includes('blob:');

        // For blob URLs, we'll try TGALoader first if user selected .tga
        // This is a simple approach - in production you'd check the actual file type
        const loader = new THREE.TextureLoader();
        const tgaLoader = new TGALoader();

        const onTextureLoad = (texture) => {
            console.log('Texture loaded:', url);

            // Apply texture to all meshes in the player model
            this.mesh.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.map = texture;
                    child.material.color.setHex(0xffffff); // Reset to white so texture shows properly
                    child.material.needsUpdate = true;
                }
            });
        };

        const onError = (error) => {
            console.log('TextureLoader failed, trying TGALoader...');
            // Fallback to TGA loader
            tgaLoader.load(url, onTextureLoad, undefined, (err) => {
                console.error('Both loaders failed:', err);
            });
        };

        // Try standard TextureLoader first
        loader.load(url, onTextureLoad, undefined, onError);
    }

    createHealthBar() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 16;
        this.healthBarCanvas = canvas;
        this.healthBarCtx = canvas.getContext('2d');

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        this.healthBarTexture = texture;

        const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
        this.healthBarSprite = new THREE.Sprite(material);
        this.healthBarSprite.scale.set(1.2, 0.15, 1);
        this.healthBarSprite.position.set(0, 2.5, 0);
        // CRITICAL: Disable raycasting on this sprite to prevent Raycaster errors
        this.healthBarSprite.raycast = () => { };
        this.mesh.add(this.healthBarSprite);

        this.drawHealthBar();
    }

    drawHealthBar() {
        const ctx = this.healthBarCtx;
        if (!ctx) return;
        const w = this.healthBarCanvas.width;
        const h = this.healthBarCanvas.height;
        const pct = Math.max(0, this.health / this.maxHealth);

        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, w, h);

        // Health fill
        if (pct > 0.5) {
            ctx.fillStyle = '#44ff44';
        } else if (pct > 0.25) {
            ctx.fillStyle = '#ff8800';
        } else {
            ctx.fillStyle = '#ff2222';
        }
        ctx.fillRect(2, 2, (w - 4) * pct, h - 4);

        // Border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, w, h);

        if (this.healthBarTexture) {
            this.healthBarTexture.needsUpdate = true;
        }
    }

    dispose() {
        if (this.mesh) {
            this.game.scene.remove(this.mesh);
        }
        if (this.pivot) {
            this.game.scene.remove(this.pivot);
        }
        if (this.healthBarSprite) {
            this.mesh.remove(this.healthBarSprite);
        }
        if (this.game.physicsManager && this.id) {
            this.game.physicsManager.removeRagdoll(this.id);
        }
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

    takeLightningStrike() {
        if (this.isDead || !this.isLocal || this.isInvincible) return;

        this.stunCount++;
        console.log(`[Player] Lightning Strike! Stun count: ${this.stunCount}/3`);

        // Camera Shake
        if (this.camera) {
            const originalPosition = this.camera.position.clone();
            let shakeTime = 0;
            const shakeDuration = 0.5;
            const shakeAmount = 0.3;

            const shakeInterval = setInterval(() => {
                shakeTime += 0.05;
                if (shakeTime >= shakeDuration) {
                    clearInterval(shakeInterval);
                    this.camera.position.copy(originalPosition);
                } else {
                    this.camera.position.x = originalPosition.x + (Math.random() - 0.5) * shakeAmount;
                    this.camera.position.y = originalPosition.y + (Math.random() - 0.5) * shakeAmount;
                    this.camera.position.z = originalPosition.z + (Math.random() - 0.5) * shakeAmount;
                }
            }, 50);
        }

        if (this.stunCount >= 3) {
            // Guaranteed lethal damage on 3rd strike
            this.takeDamage(this.health, new THREE.Vector3(0, -1, 0));
            return;
        }

        // Apply Stun State
        this.isStunned = true;
        this.velocity.set(0, 0, 0); // Stop moving instantly

        // Randomly pick Front or Back stun animation
        const isFront = Math.random() > 0.5;
        const animName = isFront ? 'StandUpFront' : 'StandUpBack';

        console.log(`[Player] Playing Stun Animation: ${animName}`);

        // Set currentAction so updateAnimationWeights knows which stun anim to prioritize
        this.currentAction = animName;

        if (this.animations[animName]) {
            const action = this.animations[animName];
            // Directly reset and play — fadeToAction is deprecated/empty
            action.reset();
            action.setEffectiveWeight(1.0);
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
            action.play();

            // Zero out all other animations so only the stun plays
            Object.keys(this.animations).forEach(key => {
                if (key !== animName && this.animations[key]) {
                    this.animations[key].setEffectiveWeight(0);
                }
            });

            // Listen for the animation to finish
            const onAnimationFinished = (e) => {
                if (e.action === action) {
                    this.mixer.removeEventListener('finished', onAnimationFinished);
                    if (!this.isDead) {
                        this.isStunned = false;
                        this.currentAction = 'Idle';
                        console.log("[Player] Recovered from stun!");
                    }
                }
            };
            this.mixer.addEventListener('finished', onAnimationFinished);

            // Fallback in case the event listener fails
            setTimeout(() => {
                if (this.isStunned && !this.isDead) {
                    this.mixer.removeEventListener('finished', onAnimationFinished);
                    this.isStunned = false;
                    this.currentAction = 'Idle';
                    console.log("[Player] Recovered via fallback timer!");
                }
            }, 6000); // Increased max stun time fallback to ensure full recovery anim plays
        } else {
            console.warn(`[Player] Stun animation '${animName}' not loaded yet!`);
            // Fallback if animations not loaded yet
            setTimeout(() => {
                if (!this.isDead) {
                    this.isStunned = false;
                    this.currentAction = 'Idle';
                }
            }, 2000);
        }
    }
}
