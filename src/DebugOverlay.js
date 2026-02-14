
export function createDebugOverlay() {
    const debugOverlay = document.createElement('div');
    debugOverlay.id = 'debug-overlay';
    debugOverlay.style.position = 'absolute';
    debugOverlay.style.top = '10px';
    debugOverlay.style.left = '10px';
    debugOverlay.style.color = 'yellow';
    debugOverlay.style.fontFamily = 'monospace';
    debugOverlay.style.fontSize = '14px';
    debugOverlay.style.fontWeight = 'bold';
    debugOverlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
    debugOverlay.style.padding = '10px';
    debugOverlay.style.zIndex = '9999';
    debugOverlay.style.pointerEvents = 'none';
    document.body.appendChild(debugOverlay);
    return debugOverlay;
}

export function updateDebugOverlay(player) {
    let debugOverlay = document.getElementById('debug-overlay');
    if (!debugOverlay) {
        debugOverlay = createDebugOverlay();
    }

    if (!player) return;

    let content = `Current Action: ${player.currentAction}<br>`;
    content += `State: ${player.state || 'N/A'}<br>`;

    // Movement Flags
    const isMoving = player.moveForward || player.moveBackward || player.moveLeft || player.moveRight;
    content += `Moving: ${isMoving} (F:${player.moveForward} B:${player.moveBackward} L:${player.moveLeft} R:${player.moveRight})<br>`;
    content += `Position: ${player.mesh.position.x.toFixed(2)}, ${player.mesh.position.z.toFixed(2)}<br>`;

    // Animation States
    // animations is an object { Idle: Action, Run: Action ... }
    if (player.animations) {
        content += '<br>Animations:<br>';
        Object.keys(player.animations).forEach(key => {
            const action = player.animations[key];
            if (action) {
                const weight = action.getEffectiveWeight().toFixed(2);
                const running = action.isRunning();
                const time = action.time.toFixed(2);
                const paused = action.paused;

                let color = 'white';
                if (weight > 0.5) color = 'lime';
                else if (weight > 0) color = 'orange';
                else color = 'gray';

                content += `<span style="color:${color}">${key}: W=${weight} R=${running} P=${paused} T=${time}</span><br>`;
            }
        });
    }

    // Mixer
    if (player.mixer) {
        content += `<br>Mixer Time: ${player.mixer.time.toFixed(2)}<br>`;
    }

    debugOverlay.innerHTML = content;
}
