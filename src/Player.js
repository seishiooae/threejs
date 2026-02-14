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
        this.isThirdPerson = false; // Default View

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
        this.animations = {};
        this.currentAction = 'Idle';
        this.state = 'Idle'; // Added for animation state management

        // Wrapper for FBX model to separate rotations
        // mesh handles Y rotation (yaw), modelWrapper handles X rotation (stand up)
        this.modelWrapper = null;

        this.init();
        this.autoLoadModels();
    }

    autoLoadModels() {
        // Automatically load models from /models/ directory
        // loadFBX creates the mixer AND loads shoot.FBX internally,
        // then onComplete loads idle animation and texture
        this.loadFBX('/models/run.FBX', () => {
            console.log('Auto-load: Main model loaded, loading additional assets...');
            // Load separate Idle animation (run.FBX only has run anim)
            this.loadExternalAnimation('/models/idle.FBX', 'Idle');
            // Texture
            this.applyTexture('/models/skelton999.TGA');
        });
    }

    init() {
        if (this.isLocal) {
            // Local player setup
            this.game.scene.add(this.pivot); // Pivot moves in the world
            this.pivot.position.y = 1.6; // Initial eye height roughly

            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            this.pivot.add(this.camera); // Camera is child of pivot

            // FPS Position (0,0,0 relative to pivot)
            this.camera.position.set(0, 0, 0);

            // Controls rotate/move the PIVOT, not the camera directly
            this.controls = new PointerLockControls(this.pivot, document.body);

            // Add weapon placeholder (Gun) - attached to camera so it follows view
            const gunGeo = new THREE.BoxGeometry(0.1, 0.1, 0.5);
            const gunMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
            this.gun = new THREE.Mesh(gunGeo, gunMat);
            this.gun.position.set(0.2, -0.1, -0.3);
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
            this.mesh.visible = false; // Hide in FPS

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

            console.log('FBX Hierarchy Loaded: Wrapper X=-PI/2');

            // 4. Force Gray Material on all meshes
            object.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x888888,
                        roughness: 0.7,
                        metalness: 0.1,
                        side: THREE.DoubleSide
                    });
                }
            });

            this.mixer = new THREE.AnimationMixer(object);

            this.animations = {};

            if (object.animations.length > 0) {
                console.log('Loaded Animations:', object.animations.map(c => c.name));

                // Debug: Log bone names to identify upper body spine/chest
                const boneNames = [];
                object.traverse((child) => {
                    if (child.isBone) {
                        boneNames.push(child.name);
                        // Cache Aim Bone
                        if (child.name.toLowerCase().includes('rightarm') || child.name.toLowerCase().includes('right_arm')) {
                            this.rightArmBone = child;
                            console.log('Found Right Arm Bone for aiming:', child.name);
                        }
                        if (child.name.toLowerCase().includes('spine')) {
                            this.spineBone = child;
                        }
                        if (child.name.toLowerCase().includes('hips')) {
                            this.hipsBone = child;
                            console.log('Found Hips Bone:', child.name);
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

            // Call onComplete callback if provided (for auto-load chaining)
            if (onComplete) onComplete();

        }, undefined, (error) => {
            console.error('An error happened loading FBX', error);
        });
    }

    // loadDefaultAssets removed to revert to manual loading flow

    createLegsClip(sourceClip, namePrefix) {
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
            const clipName = namePrefix + '_Legs';
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
                if (isOneShot) {
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true; // Hold pose after shooting
                } else {
                    action.setLoop(THREE.LoopRepeat);
                }

                this.animations[name] = action;
                console.log(`Loaded external animation: ${name} from ${fullUrl}`);

                // If replacing the currently active action, auto-switch to the new one
                if (name === this.currentAction) {
                    action.reset().fadeIn(0.3).play();
                    console.log(`Auto-switched to new ${name} animation`);
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
                }
            });

            // Find Right Hand Bone
            let handBone = null;
            this.mesh.traverse((child) => {
                if (child.isBone && (child.name.toLowerCase().includes('righthand') || child.name.toLowerCase().includes('right_hand'))) {
                    handBone = child;
                }
            });

            if (handBone) {
                handBone.add(object);
                this.weapon = object;

                // 1. Try Loading from LocalStorage
                const savedData = localStorage.getItem('doom_weapon_transform');
                if (savedData) {
                    try {
                        const parsed = JSON.parse(savedData);
                        if (parsed.pos && parsed.rot) {
                            object.position.set(parsed.pos.x, parsed.pos.y, parsed.pos.z);
                            object.rotation.set(parsed.rot.x, parsed.rot.y, parsed.rot.z);
                            console.log('Loaded Weapon Transform from LocalStorage:', parsed);
                        }
                    } catch (e) {
                        console.error('Failed to parse saved weapon transform', e);
                    }
                } else {
                    // 2. Default (if no save)
                    // (0,0,0) is default
                }

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
        if (this.isLocal) {
            this.handleMovement(delta, walls, isFiring);
        }

        if (this.mixer) {
            this.mixer.update(delta);

            // POST-ANIMATION ADJUSTMENT (only when aiming + moving)
            const isMoving = this.moveForward || this.moveBackward || this.moveLeft || this.moveRight;
            if (this.isLocal && isMoving && isFiring) {

                // STABILIZATION: Lock Spine Rotation to effectively cancel Hips Sway
                // We want the Spine to have a fixed rotation relative to the Player Mesh (Model Root),
                // regardless of how the Hips (Parent) are moving/rotating during the Run cycle.

                if (this.spineBone && this.mesh) {
                    // 1. Get Parent (Hips) World Quaternion
                    const parentQuat = new THREE.Quaternion();
                    if (this.spineBone.parent) {
                        this.spineBone.parent.getWorldQuaternion(parentQuat);
                    } else {
                        parentQuat.copy(this.mesh.quaternion);
                    }

                    // 2. Define Desired World Quaternion
                    const meshQuat = new THREE.Quaternion();
                    this.mesh.getWorldQuaternion(meshQuat);

                    // Apply Arch Offset
                    const archQuat = new THREE.Quaternion();
                    archQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);

                    const targetQuat = meshQuat.clone().multiply(archQuat);

                    // 3. Calculate Scale-agnostic Local Quaternion
                    // q_local = q_parent_inverse * q_target
                    const finalQuat = parentQuat.clone().invert().multiply(targetQuat);

                    // 4. Apply
                    this.spineBone.quaternion.copy(finalQuat);
                    this.spineBone.updateMatrix();
                    this.spineBone.updateMatrixWorld();
                }

                // 2. Eliminate Gun Sway (Lateral Movement only)
                if (this.hipsBone) {
                    this.hipsBone.position.x = 0;
                    this.hipsBone.updateMatrix();
                    this.hipsBone.updateMatrixWorld();
                }

                // 3. Lock Hips Z position - REMOVED (Causes sinking)
                // if (this.hipsBone) {
                //    this.hipsBone.position.z = 0;
                // }
            }
        }
    }

    handleMovement(delta, walls, isFiring) {
        // Global Debug Key (P) - Check whenever P is pressed
        if (this.game.keys && this.game.keys['KeyP']) {
            console.log('--- Debug P Key ---');
            console.log('Weapon Object:', this.weapon);
            console.log('Game Keys State:', this.game.keys);
            if (this.weapon) {
                console.log('Weapon Pos:', this.weapon.position);
                console.log('Weapon Rot:', this.weapon.rotation);

                // SAVE TO LOCAL STORAGE (Manual)
                const saveData = {
                    pos: { x: this.weapon.position.x, y: this.weapon.position.y, z: this.weapon.position.z },
                    rot: { x: this.weapon.rotation.x, y: this.weapon.rotation.y, z: this.weapon.rotation.z }
                };
                localStorage.setItem('doom_weapon_transform', JSON.stringify(saveData));
                console.log('Saved to localStorage (Manual P Key)');

            } else {
                console.warn('Weapon is NULL - Load failed or pending');
            }
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
                        console.log('Gizmo ON: Translate Mode. Animation FROZEN in Shoot Pose.');

                        // FORCE SHOOT POSE
                        if (this.animations['Shoot']) {
                            this.animations['Shoot'].reset().play();
                            this.animations['Shoot'].paused = true; // Freeze at frame 0? 
                            // Better: Play to middle?
                            // For now, just Pause.
                            // Ensure Weight is 1.0
                            this.animations['Shoot'].setEffectiveWeight(1.0);
                            if (this.animations['Idle']) this.animations['Idle'].setEffectiveWeight(0);
                            if (this.animations['Run']) this.animations['Run'].setEffectiveWeight(0);
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
                        localStorage.setItem('doom_weapon_transform', JSON.stringify(saveData));
                        console.log('Gizmo Exit: Saved to localStorage');
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

            // Rotation Adjustment (Shift + Keys)
            const isShift = this.game.keys['ShiftLeft'] || this.game.keys['ShiftRight'];
            if (this.game.keys['KeyI'] || this.game.keys['KeyJ'] || this.game.keys['KeyK'] || this.game.keys['KeyL']) {
                console.log('Adjustment Key Pressed. Shift:', isShift);
            }

            if (isShift) {
                const rotSpeed = 0.05;
                if (this.game.keys['KeyI']) this.weapon.rotation.x -= rotSpeed;
                if (this.game.keys['KeyK']) this.weapon.rotation.x += rotSpeed;
                if (this.game.keys['KeyJ']) this.weapon.rotation.y -= rotSpeed;
                if (this.game.keys['KeyL']) this.weapon.rotation.y += rotSpeed;
                if (this.game.keys['KeyU']) this.weapon.rotation.z += rotSpeed;
                if (this.game.keys['KeyO']) this.weapon.rotation.z -= rotSpeed;
            }
            // Position Adjustment (Single Keys)
            else {
                const speed = 0.1; // 10cm per frame
                if (this.game.keys['KeyI']) { this.weapon.position.z -= speed; console.log('Pos Z-', this.weapon.position); }
                if (this.game.keys['KeyK']) { this.weapon.position.z += speed; console.log('Pos Z+', this.weapon.position); }
                if (this.game.keys['KeyJ']) { this.weapon.position.x -= speed; console.log('Pos X-', this.weapon.position); }
                if (this.game.keys['KeyL']) { this.weapon.position.x += speed; console.log('Pos X+', this.weapon.position); }
                if (this.game.keys['KeyU']) { this.weapon.position.y += speed; console.log('Pos Y+', this.weapon.position); }
                if (this.game.keys['KeyO']) { this.weapon.position.y -= speed; console.log('Pos Y-', this.weapon.position); }
            }
        }

        // Log Values
        // Log Values
        if (this.game.keys && this.game.keys['KeyP']) {
            console.log('Weapon Pos:', this.weapon.position);
            console.log('Weapon Rot:', this.weapon.rotation);
            console.log('Weapon Scale:', this.weapon.scale);
        }


        if (!this.controls.isLocked) return;

        // Apply damping
        this.velocity.x -= this.velocity.x * 10.0 * delta;
        this.velocity.z -= this.velocity.z * 10.0 * delta;

        this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
        this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
        this.direction.normalize();

        const speed = 30.0;
        if (this.moveForward || this.moveBackward) this.velocity.z -= this.direction.z * speed * delta;
        if (this.moveLeft || this.moveRight) this.velocity.x -= this.direction.x * speed * delta;

        this.controls.moveRight(-this.velocity.x * delta);
        this.controls.moveForward(-this.velocity.z * delta);

        // --- Animation Logic ---
        const isMoving = (this.moveForward || this.moveBackward || this.moveLeft || this.moveRight);

        if (isMoving) {
            this.currentAction = 'Run';
        } else {
            this.currentAction = 'Idle';
        }

        // CRITICAL: Continuous State-Driven Animation Weight Management
        this.updateAnimationWeights(delta, isMoving, isFiring);

        // Sync visual mesh to physics pivot
        this.mesh.position.copy(this.pivot.position);
        this.mesh.position.y -= 1.6;


        // Sync Rotation: Player facing relative to camera
        // W=back to camera, S=face camera, A=face left, D=face right
        // This relationship is maintained as camera rotates (mouse moves)
        // With Hierarchy: mesh handles Y-rotation, wrapper handles X-rotation (stand up)

        // Only apply if modelWrapper exists (FBX loaded)
        // Update Mesh rotation if Moving OR Aiming (Firing)
        // This ensures the player faces the target when shooting even if standing still.
        if ((isMoving || isFiring) && this.modelWrapper) {
            // Calculate Camera Yaw from World Direction (ignoring Pitch)
            // This fixes the issue where WASD direction distorts when looking up/down
            const cameraDir = new THREE.Vector3();
            this.camera.getWorldDirection(cameraDir);
            cameraDir.y = 0; // Project to horizontal plane
            cameraDir.normalize();

            // Calculate Yaw angle from direction vector
            const cameraYaw = Math.atan2(cameraDir.x, cameraDir.z);

            // Determine player's facing angle relative to camera
            let facingOffset = 0; // Default: W (aligned with camera)

            if (isMoving) {
                if (this.moveBackward && !this.moveForward) {
                    facingOffset = Math.PI; // S: face to camera
                } else if (this.moveLeft && !this.moveRight && !this.moveForward && !this.moveBackward) {
                    facingOffset = Math.PI / 2; // A only: face left
                } else if (this.moveRight && !this.moveLeft && !this.moveForward && !this.moveBackward) {
                    facingOffset = -Math.PI / 2; // D only: face right
                }
            }
            // If Aiming and Not Moving (or even moving), we essentially want to face forward
            // But if moving sideways, we might want to strafe?
            // For now, let's keep the movement logic dominant if moving, 
            // but if ONLY Aiming (standing), face forward.
            if (isFiring && !isMoving) {
                facingOffset = 0; // Face forward
            }
            // Note: If Moving + Aiming, the above 'isMoving' logic applies facingOffset.
            // E.g. strafing left while aiming -> Player faces left?
            // In standard TPS, you usually strafe (face forward, move left).
            // But our animation 'Run' is forward running. We don't have strafe anims.
            // So if running Left, we MUST face Left. The camera/aim is to the side.
            // This is a limitation of current assets. 
            // So we leave Moving logic as is.

            // Apply rotation to mesh group (Y-axis only)
            this.mesh.rotation.y = cameraYaw + facingOffset;
        }

        // When not moving, rotation stays unchanged - camera orbits

        // --- Camera Aiming Logic ---
        // ... (lines 520+)

        // ...

        // (Move to shoot method)

        // When not moving, rotation stays unchanged - camera orbits

        // --- Camera Aiming Logic ---
        // Lerp camera position based on aiming state
        if (this.isThirdPerson) {
            const aiming = isFiring; // Simple aimed state

            // Define Targets
            const targetPos = aiming
                // Aim: Left (-2.5), High (2.5), Back (4.0)
                // Pushes player FAR to the right side of the screen
                ? new THREE.Vector3(-2.5, 2.5, 4.0)
                : new THREE.Vector3(0.4, 0.6, 3.0); // Normal

            // Rotation tweaks
            // Pitch down (-0.3) to see ground, Yaw (0) to keep player right
            const targetRot = aiming
                ? new THREE.Euler(-0.3, 0, 0)
                : new THREE.Euler(0, 0, 0);

            // Smoothly interpolate
            const lerpSpeed = 5.0 * delta;
            this.camera.position.lerp(targetPos, lerpSpeed);

            // Quaternion slerp for rotation
            const targetQuat = new THREE.Quaternion().setFromEuler(targetRot);
            this.camera.quaternion.slerp(targetQuat, lerpSpeed);
        }

        // NOTE: mixer.update is now called ONLY in update(), not here.
        // The duplicate call here was overwriting post-animation spine corrections.
        // REVERT: Add it back to restore original "shaky" behavior
        if (this.mixer) {
            this.mixer.update(delta);
        }
    }



    updateAnimationWeights(delta, isMoving, isFiring) {
        if (!this.mixer) return;

        // If Gizmo is active, DO NOT update weights (Keep Shoot Pose Frozen)
        if (this.gizmoActive) return;

        // 1. Determine System State
        const shootAction = this.animations['Shoot'];
        // Use isFiring (input held) ONLY. 
        // If we include isRunning(), the clamped "Shoot" pose might persist.
        // User wants "W Key Only = Full Run", so we strictly follow input.
        const isShooting = isFiring;

        // Default Targets
        const targets = {
            'Idle': 0,
            'Idle_Upper': 0,
            'Run': 0,
            'Run_Legs': 0,
            'Shoot': 0,
            'Shoot_Upper': 0 // Added for running-shooting
        };

        if (isShooting) {
            if (isMoving) {
                // Moving + Shooting
                // Use Upper Body Shoot + Running Legs
                targets['Shoot_Upper'] = 1.0;
                targets['Run_Legs'] = 1.0;

                targets['Shoot'] = 0.0; // Disable Full Body Shoot
                targets['Idle'] = 0.0;
                targets['Run'] = 0.0;
            } else {
                // Stopped + Shooting
                // Use Full Body Shoot Animation (User Request)
                targets['Shoot'] = 1.0;

                targets['Shoot_Upper'] = 0.0;
                targets['Idle'] = 0.0; // Completely replace Idle
                targets['Run_Legs'] = 0.0;
                targets['Run'] = 0.0;
            }
        } else {
            // Not Shooting
            targets['Shoot'] = 0.0;
            if (isMoving) {
                // Moving Normal
                targets['Run'] = 1.0;
            } else {
                // Stopped Normal
                targets['Idle'] = 1.0;
            }
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
            if (target > 0 && !action.isRunning()) action.play();
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
        // Kept empty to prevent errors if called from elsewhere
    }

    shoot() {
        // Play Animation
        if (this.mixer && this.animations['Shoot']) {
            const shootAction = this.animations['Shoot'];

            // Just start the animation. The updateAnimationWeights will handle the blending.
            shootAction.reset();
            shootAction.setEffectiveWeight(1.0);
            shootAction.setLoop(THREE.LoopOnce);
            shootAction.clampWhenFinished = true; // Keep last frame until faded out by updater
            shootAction.play();

            console.log('Shooting triggered');
        }

        let origin;
        let direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);

        if (this.isThirdPerson) {
            // 2. Origin: Use weapon barrel position if available
            if (this.weapon) {
                origin = new THREE.Vector3();
                this.weapon.getWorldPosition(origin);

                // 3. Direction: Gun barrel forward = local -Y axis
                const weaponQuat = new THREE.Quaternion();
                this.weapon.getWorldQuaternion(weaponQuat);
                direction.set(0, -1, 0).applyQuaternion(weaponQuat);
                direction.normalize();

                // Move origin forward to muzzle position (approx 1.5m from grip)
                // And adding a slight vertical offset (0.10m) to align with barrel height
                // Assuming Local -Y is Forward, Local Z is Up
                const forwardOffset = direction.clone().multiplyScalar(1.5);

                // Calculate local UP vector (Z-axis rotated)
                const localUp = new THREE.Vector3(0, 0, 1).applyQuaternion(weaponQuat);
                const upOffset = localUp.multiplyScalar(0.10);

                origin.add(forwardOffset).add(upOffset);
            } else {
                // Fallback: Aim Target: Camera Forward at distance (50m)
                const aimTarget = this.camera.localToWorld(new THREE.Vector3(0, 0, -50));

                // Origin: Start from player visual center/chest
                origin = this.pivot.position.clone();
                origin.y -= 0.3;

                // Offset to right hand side (Gun is on Right)
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.pivot.quaternion);
                origin.add(right.multiplyScalar(0.4));

                direction.subVectors(aimTarget, origin).normalize();

                // Move origin slightly forward to clear self-collision
                origin.add(direction.clone().multiplyScalar(0.5));
            }

        } else {
            // In FPS, start from camera
            origin = this.camera.getWorldPosition(new THREE.Vector3());
        }

        return { origin, direction };
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
            // Only sync Yaw (Y-axis) to avoid tilting the character mesh up/down
            return { x: 0, y: this.pivot.rotation.y, z: 0 };
        }
        return this.mesh.rotation;
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
}
