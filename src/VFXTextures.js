import * as THREE from 'three';

/**
 * Procedurally generated textures for realistic fire/smoke VFX.
 * These replace the generic sprite sheet with soft, physically-based gradients.
 */

/** Soft radial glow – white-hot center fading to transparent edge */
export function createFireGlowTexture(size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2;

    // Multi-stop radial gradient mimicking real combustion glow
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0.0, 'rgba(255, 255, 240, 1.0)');  // White-hot core
    grad.addColorStop(0.15, 'rgba(255, 220, 120, 0.95)'); // Bright yellow
    grad.addColorStop(0.35, 'rgba(255, 150, 50, 0.7)');   // Orange
    grad.addColorStop(0.6, 'rgba(200, 60, 10, 0.35)');    // Dark orange-red
    grad.addColorStop(0.8, 'rgba(100, 20, 5, 0.1)');      // Deep red
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');         // Transparent edge

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

/** Soft smoke puff – gray center fading to transparent */
export function createSmokeTexture(size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2;

    // Add some noise-like variation via multiple overlapping circles
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0.0, 'rgba(180, 180, 180, 0.6)');
    grad.addColorStop(0.3, 'rgba(140, 140, 140, 0.4)');
    grad.addColorStop(0.6, 'rgba(100, 100, 100, 0.2)');
    grad.addColorStop(0.85, 'rgba(60, 60, 60, 0.05)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Add a couple offset blobs for organic edges
    for (let i = 0; i < 4; i++) {
        const ox = cx + (Math.random() - 0.5) * r * 0.6;
        const oy = cy + (Math.random() - 0.5) * r * 0.6;
        const blobR = r * (0.3 + Math.random() * 0.3);
        const blobGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, blobR);
        blobGrad.addColorStop(0.0, 'rgba(160, 160, 160, 0.2)');
        blobGrad.addColorStop(1.0, 'rgba(100, 100, 100, 0.0)');
        ctx.fillStyle = blobGrad;
        ctx.beginPath();
        ctx.arc(ox, oy, blobR, 0, Math.PI * 2);
        ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

/** Bright spark dot – tiny concentrated point of light */
export function createSparkTexture(size = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.1, 'rgba(255, 240, 200, 0.9)');
    grad.addColorStop(0.3, 'rgba(255, 180, 60, 0.5)');
    grad.addColorStop(0.6, 'rgba(255, 100, 20, 0.15)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}
