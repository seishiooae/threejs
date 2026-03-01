const fs = require('fs');

function parseFBX(file) {
    console.log(`\n=== Scanning ${file} ===`);
    try {
        const content = fs.readFileSync(file, 'utf8');
        const regex = /Model: \d+, "Model::([^"]+)", "Mesh"/g;
        let match;
        const names = new Set();
        while ((match = regex.exec(content)) !== null) {
            names.add(match[1]);
        }

        if (names.size > 0) {
            console.log("Found Meshes:", Array.from(names));
        } else {
            console.log("No exact 'Mesh' matches found. Trying generic search...");
            const genericRegex = /"Model::([^"]+)"/g;
            const genericNames = new Set();
            while ((match = genericRegex.exec(content)) !== null) {
                genericNames.add(match[1]);
            }
            console.log("Found Models:", Array.from(genericNames));
        }
    } catch (e) {
        console.error("Error reading file:", e.message);
    }
}

parseFBX('./public/models/enemy/kongou123.FBX');
parseFBX('./public/models/enemy/SM_FireBase.FBX');
