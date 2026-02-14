export class MiniMap {
    constructor(game) {
        this.game = game;
        this.canvas = document.getElementById('minimap');
        this.ctx = this.canvas.getContext('2d');
        this.size = 200; // Canvas dimensions

        // Map settings
        this.mapScale = 0; // Calculated based on map size
        this.padding = 10;
    }

    update() {
        if (!this.game.level || !this.game.player) return;

        const mapData = this.game.level.map;
        const cellSize = this.game.level.cellSize;
        const rows = mapData.length;
        const cols = mapData[0].length;

        // Calculate scale to fit map in canvas
        const mapWorldWidth = cols * cellSize;
        const mapWorldHeight = rows * cellSize;
        this.mapScale = (this.size - this.padding * 2) / Math.max(mapWorldWidth, mapWorldHeight);

        // Clear canvas
        this.ctx.clearRect(0, 0, this.size, this.size);
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.fillRect(0, 0, this.size, this.size);

        // Draw Map
        this.ctx.fillStyle = '#666';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (mapData[r][c] === 1) {
                    const x = c * cellSize * this.mapScale + this.padding;
                    const y = r * cellSize * this.mapScale + this.padding;
                    const w = cellSize * this.mapScale;
                    const h = cellSize * this.mapScale;
                    this.ctx.fillRect(x, y, w, h);
                }
            }
        }

        // Draw Local Player
        const playerPos = this.game.player.getPosition();
        this.drawPlayer(playerPos, 'lime', true);

        // Draw Remote Players
        for (const id in this.game.remotePlayers) {
            const p = this.game.remotePlayers[id];
            // Remote player could be Player instance or Mesh depending on refactor stage
            // We ensured updateRemotePlayer kept 'mesh' logic or 'Player' logic.
            // Game.js createRemotePlayer now returns Player instance
            if (p.mesh) {
                this.drawPlayer(p.mesh.position, 'red', false);
            }
        }
    }

    drawPlayer(position, color, isLocal) {
        // Convert world pos (x, z) to map pos
        // World (0,0) is usually top-left of grid depending on level generation
        // Level generation: col * cellSize, row * cellSize. So (0,0) world matches (0,0) map index.

        const x = position.x * this.mapScale + this.padding;
        const y = position.z * this.mapScale + this.padding;

        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(x, y, 4, 0, Math.PI * 2);
        this.ctx.fill();

        // Direction arrow for local player
        if (isLocal) {
            const rot = this.game.player.getRotation(); // Euler
            // Rotation.y is standard yaw
            const dirX = Math.sin(rot.y) * 8;
            const dirY = Math.cos(rot.y) * 8;

            this.ctx.strokeStyle = 'white';
            this.ctx.beginPath();
            this.ctx.moveTo(x, y);
            this.ctx.lineTo(x - dirX, y - dirY); // Three.js rotation might be inverted visual
            // Actually rotation.y 0 is usually looking down -Z. 
            // Canvas Y is down. Z increases down. So +Z is down.
            // Let's keep it simple line
            this.ctx.stroke();
        }
    }
}
