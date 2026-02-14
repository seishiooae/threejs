import * as THREE from 'three';

export class Level {
    constructor(scene) {
        this.scene = scene;
        this.walls = [];
        this.floor = null;
        this.sky = null;

        // Simple map: 1 = Wall, 0 = Empty
        this.map = [
            [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
            [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            [1, 0, 1, 1, 1, 1, 1, 1, 0, 1],
            [1, 0, 1, 0, 0, 0, 0, 1, 0, 1],
            [1, 0, 1, 0, 0, 0, 0, 1, 0, 1],
            [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            [1, 0, 1, 1, 1, 1, 0, 1, 0, 1],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 1],
            [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
        ];

        this.cellSize = 5; // Size of each grid cell
        this.generate();
    }

    generate() {
        this.createSky();

        // Create Floor
        const mapWidth = this.map[0].length * this.cellSize;
        const mapHeight = this.map.length * this.cellSize;

        const loader = new THREE.TextureLoader();

        // Floor Texture
        const floorTexture = loader.load('/floor.png');
        floorTexture.colorSpace = THREE.SRGBColorSpace;
        floorTexture.wrapS = THREE.RepeatWrapping;
        floorTexture.wrapT = THREE.RepeatWrapping;
        floorTexture.repeat.set(10, 10); // Repeat texture for tiling

        const floorGeometry = new THREE.PlaneGeometry(mapWidth, mapHeight);
        const floorMaterial = new THREE.MeshStandardMaterial({
            map: floorTexture,
            color: 0xffffff,
            roughness: 0.8
        });
        this.floor = new THREE.Mesh(floorGeometry, floorMaterial);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.set(mapWidth / 2 - this.cellSize / 2, 0, mapHeight / 2 - this.cellSize / 2);
        this.scene.add(this.floor);

        // Create Walls
        const wallTexture = loader.load('/wall.png');
        wallTexture.colorSpace = THREE.SRGBColorSpace;

        const wallGeometry = new THREE.BoxGeometry(this.cellSize, 4, this.cellSize);
        const wallMaterial = new THREE.MeshStandardMaterial({
            map: wallTexture,
            color: 0xffffff
        });

        for (let row = 0; row < this.map.length; row++) {
            for (let col = 0; col < this.map[row].length; col++) {
                if (this.map[row][col] === 1) {
                    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
                    // Position based on grid
                    wall.position.set(
                        col * this.cellSize,
                        2, // Height / 2
                        row * this.cellSize
                    );
                    this.scene.add(wall);
                    this.walls.push(wall);

                    // Add Edges for retro visibility
                    const edges = new THREE.EdgesGeometry(wallGeometry);
                    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
                    wall.add(line);
                }
            }
        }

        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);

        // Add directional light
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(10, 20, 10);
        this.scene.add(dirLight);
    }

    createSky() {
        const loader = new THREE.TextureLoader();
        const texture = loader.load('/sky.png');
        texture.colorSpace = THREE.SRGBColorSpace;

        const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
        const skyMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.BackSide,
            fog: false
        });
        this.sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(this.sky);
    }

    getCollidables() {
        return this.walls;
    }
}
