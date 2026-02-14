import * as THREE from 'three';

export class Bullet {
    constructor(scene, position, direction) {
        this.scene = scene;
        this.speed = 40; // Slightly slower for visibility
        this.alive = true;
        this.lifeTime = 2.0; // Seconds

        // specific visual for the bullet (Tracer style)
        // Cylinder oriented along Z-axis by default, we'll rotate it to match direction
        const geometry = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8);
        geometry.rotateX(Math.PI / 2); // Align with Z axis for easier lookAt

        const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);

        this.velocity = direction.clone().multiplyScalar(this.speed);
        this.mesh.lookAt(this.mesh.position.clone().add(this.velocity));

        scene.add(this.mesh);
    }

    update(delta) {
        if (!this.alive) return;

        this.lifeTime -= delta;
        if (this.lifeTime <= 0) {
            this.destroy();
            return;
        }

        // Move bullet
        const moveStep = this.velocity.clone().multiplyScalar(delta);
        this.mesh.position.add(moveStep);

        // Simple raycast for collision detection could be done here or in Game
        // For now, let's keep it visual and rely on immediate raycast for hit logic
    }

    destroy() {
        this.alive = false;
        this.scene.remove(this.mesh);
    }
}
