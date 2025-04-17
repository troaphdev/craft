import * as THREE from 'https://esm.sh/three@0.150.1';
// import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'; // Remove OrbitControls
import { PointerLockControls } from 'https://esm.sh/three@0.150.1/examples/jsm/controls/PointerLockControls.js';
import { createNoise3D } from 'https://esm.sh/simplex-noise@4.0.1'; // Use CDN link for simplex-noise

// --- Constants ---
const CHUNK_SIZE_X = 16;
const CHUNK_SIZE_Y = 64; // Max world height
const CHUNK_SIZE_Z = 16;
const BLOCK_SIZE = 1; // Size of each block in world units

// Simple Block Type Registry (can be expanded)
const BLOCK_TYPES = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    WOOD: 4,
    LEAVES: 5,
};

// Simple Block Colors (replace with textures later)
const BLOCK_COLORS = {
    [BLOCK_TYPES.GRASS]: 0x559022,
    [BLOCK_TYPES.DIRT]: 0x8b5a2b,
    [BLOCK_TYPES.STONE]: 0x808080,
    [BLOCK_TYPES.WOOD]: 0x8b4513, // Saddle brown
    [BLOCK_TYPES.LEAVES]: 0x228b22, // Forest green
};

// Noise generators
const noise3D = createNoise3D();
const terrainNoiseScale = 0.05;
const treeNoiseScale = 0.1; // Noise for tree placement probability
const treePlacementThreshold = 0.7; // Value noise must exceed to place a tree

// Player Movement Constants - Refined
const PLAYER_HEIGHT = 2.0 * BLOCK_SIZE;
const PLAYER_WIDTH = 0.6 * BLOCK_SIZE; // Player bounding box width/depth
const PLAYER_SPEED_GROUND = 4.3 * BLOCK_SIZE; // Slightly slower than before, more like MC default walk
const PLAYER_SPEED_AIR = PLAYER_SPEED_GROUND * 0.8; // Increased air speed control
const ACCELERATION_GROUND = 30.0 * BLOCK_SIZE;
const ACCELERATION_AIR = ACCELERATION_GROUND * 0.7; // Increased air acceleration
const FRICTION_GROUND = 0.92; // Multiplier applied each frame
const FRICTION_AIR = 0.98; // Significantly less air friction (closer to 1 = less slowdown)
const GRAVITY = -9.8 * BLOCK_SIZE * 3; // Increased gravity feel
const JUMP_VELOCITY = 8.0 * BLOCK_SIZE; // Stronger jump
const MAX_STEP_HEIGHT = 0.6 * BLOCK_SIZE; // How high the player can step up automatically
const SPRINT_MULTIPLIER = 1.5; // Speed increase when sprinting (Increased)
const NORMAL_FOV = 75;
const SPRINT_FOV = 85;
const FOV_LERP_SPEED = 8.0; // Controls how quickly FOV changes (higher = faster)
const SPRINT_HAND_Y_OFFSET_MAX = -0.05; // How much lower the hand goes when sprinting

// --- Basic Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x77b6ec); // Match CSS sky blue
scene.fog = new THREE.Fog(0x77b6ec, CHUNK_SIZE_X * 2, CHUNK_SIZE_X * 6); // Adjust fog distance

const camera = new THREE.PerspectiveCamera(NORMAL_FOV, window.innerWidth / window.innerHeight, 0.1, 1000);
// camera starts high up, will be moved by physics immediately

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
// --- Enable Shadows --- //
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // Basic shadows, good performance

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Slightly stronger ambient
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5); // Slightly weaker directional
directionalLight.position.set(15, 30, 10);
scene.add(directionalLight);
// Optional: Add shadows later if performance allows
// directionalLight.castShadow = true;
// renderer.shadowMap.enabled = true;
// --- Configure Light Shadows --- //
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024; // Shadow map resolution (power of 2)
directionalLight.shadow.mapSize.height = 1024;

// Define the area covered by the shadow camera
const shadowCamSize = 40; // How large an area the shadow covers around the origin
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 100;
directionalLight.shadow.camera.left = -shadowCamSize;
directionalLight.shadow.camera.right = shadowCamSize;
directionalLight.shadow.camera.top = shadowCamSize;
directionalLight.shadow.camera.bottom = -shadowCamSize;
// Optional: Add a shadow camera helper for debugging
// const shadowHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
// scene.add(shadowHelper);
// ---------------------------- //

// --- Hotbar UI State --- //
const hotbarSlots = document.querySelectorAll('#hotbar .hotbar-slot');
let selectedHotbarIndex = 0; // Start with the first slot (index 0)

// --- Texture Loading --- //
const textureLoader = new THREE.TextureLoader();
const handTexture = textureLoader.load('/hand.webp');
handTexture.colorSpace = THREE.SRGBColorSpace; // Ensure correct color
const pickaxeTexture = textureLoader.load('/pickaxe_holding.png');
pickaxeTexture.colorSpace = THREE.SRGBColorSpace; // Ensure correct color

// --- Hand/Item Sprite --- //
const handSpriteMaterial = new THREE.SpriteMaterial({
    map: handTexture, // Start with hand texture
    transparent: true,
    depthTest: false, // Render on top
    depthWrite: false,
    sizeAttenuation: false, // Keep size constant regardless of distance
    toneMapped: false // Prevent tone mapping from affecting sprite color/brightness
});
const handSprite = new THREE.Sprite(handSpriteMaterial);
const baseSpriteScale = 0.5; // <<< Reverted Size
handSprite.scale.set(baseSpriteScale, baseSpriteScale * (handTexture.image ? handTexture.image.height / handTexture.image.width : 1), 1); // Adjust scale (maintain aspect ratio)
handSprite.position.set(0.45, -0.3, -0.5); // Position adjusted: Reverted Y position

const pickaxeScaleMultiplier = 1.1; // Make pickaxe 10% bigger than base scale

// --- Bobbing Variables --- //
let bobbingTime = 0;
let isMoving = false;
const bobbingFrequency = 10; // How fast the bob is
const bobbingAmplitude = 0.005; // How high the bob is
const defaultHandY = handSprite.position.y; // Updated to use the reverted Y position
const defaultHandZ = handSprite.position.z; // <<< ADDED: Store default Z

// --- Attack Animation Variables --- //
let isAttacking = false;
let attackProgress = 0; // 0 = idle, 1 = full extent of swing
const attackSpeed = 15; // How fast the swing animation plays
const attackDistance = 0.1; // How far forward the item swings

// --- Punch Shake Animation Variables --- //
let isPunching = false;
let punchProgress = 0; // 0 = start, 1 = finished
const punchDuration = 0.2; // Seconds
const punchFrequency = 50; // How fast the shake is
const punchAmplitude = 0.01; // How far the shake goes

// --- Pointer Lock Controls ---
const controls = new PointerLockControls(camera, document.body);
const blocker = document.body;
const crosshair = document.getElementById('crosshair');

let isPointerLocked = false;

// Initial state: show instructions
crosshair.innerHTML = '+'; // Always show crosshair
// We need an overlay for instructions now
let instructionOverlay = document.createElement('div');
instructionOverlay.id = 'instructionOverlay';
instructionOverlay.style.cssText = `
    position: absolute;
    top: 0; left: 0; width: 100%; height: 100%;
    background-color: rgba(0,0,0,0.5);
    color: white; font-size: 20px; text-align: center;
    display: flex; justify-content: center; align-items: center;
    cursor: pointer;
`;
instructionOverlay.innerHTML = 'Click to Play';
document.body.appendChild(instructionOverlay);

instructionOverlay.addEventListener('click', () => {
    controls.lock();
    // --- Request Fullscreen --- //
    if (document.fullscreenEnabled || document.webkitFullscreenEnabled || document.mozFullScreenEnabled || document.msFullscreenEnabled) {
        const element = document.body;
        if (element.requestFullscreen) {
            element.requestFullscreen();
        } else if (element.webkitRequestFullscreen) { /* Safari */
            element.webkitRequestFullscreen();
        } else if (element.mozRequestFullScreen) { /* Firefox */
            element.mozRequestFullScreen();
        } else if (element.msRequestFullscreen) { /* IE/Edge */
            element.msRequestFullscreen();
        }
    }
    // ------------------------ //
});

controls.addEventListener('lock', () => {
    isPointerLocked = true;
    instructionOverlay.style.display = 'none';
    crosshair.style.display = ''; // Ensure crosshair is visible
});

controls.addEventListener('unlock', () => {
    isPointerLocked = false;
    instructionOverlay.style.display = 'flex'; // Show instructions again
    // crosshair.style.display = 'none'; // Keep crosshair always visible
});

scene.add(controls.object);

// --- Handle Exiting Fullscreen --- //
function handleFullscreenChange() {
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
    if (!fullscreenElement && controls.isLocked) {
        // If we exited fullscreen AND pointer is still locked, unlock it
        controls.unlock();
        // The controls 'unlock' event listener will handle showing the overlay
    }
}
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
document.addEventListener('mozfullscreenchange', handleFullscreenChange);
// document.addEventListener('MSFullscreenChange', handleFullscreenChange);
// --------------------------------- //

// --- Mouse Input for Attacking / Punching (Combined) --- //
gameCanvas.addEventListener('mousedown', (event) => {
    if (controls.isLocked && event.button === 0) { // 0 = Left mouse button
        // Trigger Attack Swing (Existing)
        if (!isAttacking) {
            isAttacking = true;
            attackProgress = 0;
        }
        // Trigger Punch Shake (New)
        if (!isPunching) {
            isPunching = true;
            punchProgress = 0;
        }
    }
});

// --- Hotbar UI Logic --- //
function updateSelectedSlot(newIndex) {
    if (newIndex >= 0 && newIndex < hotbarSlots.length) {
        // Remove selected class from the old slot
        if (hotbarSlots[selectedHotbarIndex]) {
            hotbarSlots[selectedHotbarIndex].classList.remove('selected');
        }
        // Update the index
        selectedHotbarIndex = newIndex;
        // Add selected class to the new slot
        if (hotbarSlots[selectedHotbarIndex]) {
            hotbarSlots[selectedHotbarIndex].classList.add('selected');
        }

        // --- Update Hand Sprite Texture --- //
        if (selectedHotbarIndex === 0) { // If pickaxe slot selected
            handSpriteMaterial.map = pickaxeTexture; // Uses the loaded pickaxe_holding.png
            // Adjust scale based on the actual loaded texture's aspect ratio
            const aspectRatio = pickaxeTexture.image ? pickaxeTexture.image.height / pickaxeTexture.image.width : 1;
            const finalScale = baseSpriteScale * pickaxeScaleMultiplier; // Apply multiplier
            handSprite.scale.set(finalScale, finalScale * aspectRatio, 1);
        } else { // Otherwise, show hand
            handSpriteMaterial.map = handTexture;
            // Adjust scale based on the hand texture's aspect ratio
            const aspectRatio = handTexture.image ? handTexture.image.height / handTexture.image.width : 1;
            handSprite.scale.set(baseSpriteScale, baseSpriteScale * aspectRatio, 1); // Use base scale for hand
        }
        handSpriteMaterial.needsUpdate = true;
        // --------------------------------- //

        // console.log(`Selected slot: ${selectedHotbarIndex + 1}`); // Optional debug
    }
}

// --- World Data and Meshing ---
const world = new Map(); // Use a Map to store chunks: key="x,z", value=chunkData

function getChunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`;
}

// Function to get block type at world coordinates (handles chunk boundaries)
function getBlock(x, y, z) {
    const chunkX = Math.floor(x / CHUNK_SIZE_X);
    const chunkZ = Math.floor(z / CHUNK_SIZE_Z);
    const blockX = THREE.MathUtils.euclideanModulo(x, CHUNK_SIZE_X);
    const blockY = Math.floor(y);
    const blockZ = THREE.MathUtils.euclideanModulo(z, CHUNK_SIZE_Z);

    const chunkKey = getChunkKey(chunkX, chunkZ);
    const chunkData = world.get(chunkKey);

    if (!chunkData || blockY < 0 || blockY >= CHUNK_SIZE_Y) {
        return BLOCK_TYPES.AIR; // Out of bounds or chunk not loaded
    }

    return chunkData[blockX][blockY][blockZ] || BLOCK_TYPES.AIR;
}

// Helper to check if a block is solid - Added Back
function isSolid(blockType) {
    return blockType !== BLOCK_TYPES.AIR;
}

// Generate data for a single chunk
function generateChunkData(chunkX, chunkZ) {
    const chunkData = Array(CHUNK_SIZE_X).fill(null).map(() =>
        Array(CHUNK_SIZE_Y).fill(null).map(() =>
            Array(CHUNK_SIZE_Z).fill(BLOCK_TYPES.AIR)
        )
    );

    for (let x = 0; x < CHUNK_SIZE_X; x++) {
        for (let z = 0; z < CHUNK_SIZE_Z; z++) {
            const worldX = chunkX * CHUNK_SIZE_X + x;
            const worldZ = chunkZ * CHUNK_SIZE_Z + z;

            // Terrain Height Generation
            const terrainHeight = Math.floor(noise3D(worldX * terrainNoiseScale, 0, worldZ * terrainNoiseScale) * 10 + CHUNK_SIZE_Y / 3); // Base height around Y=21
            const stoneHeight = terrainHeight - 3; // Stone below dirt

            for (let y = 0; y < CHUNK_SIZE_Y; y++) {
                if (y < stoneHeight) {
                    chunkData[x][y][z] = BLOCK_TYPES.STONE;
                } else if (y < terrainHeight) {
                     chunkData[x][y][z] = BLOCK_TYPES.DIRT;
                } else if (y === terrainHeight) {
                    chunkData[x][y][z] = BLOCK_TYPES.GRASS;
                } else {
                    chunkData[x][y][z] = BLOCK_TYPES.AIR;
                }
            }

             // Tree Generation
             if (chunkData[x][terrainHeight][z] === BLOCK_TYPES.GRASS) { // Only place on grass
                const treeNoiseVal = noise3D(worldX * treeNoiseScale, 100, worldZ * treeNoiseScale); // Use different y offset for tree noise
                if (treeNoiseVal > treePlacementThreshold) {
                    const treeHeight = Math.floor(Math.random() * 3) + 4; // 4-6 blocks tall
                    // Ensure tree fits within chunk vertically
                     if (terrainHeight + treeHeight + 2 < CHUNK_SIZE_Y) {
                        // Trunk
                        for (let th = 1; th <= treeHeight; th++) {
                             if (terrainHeight + th < CHUNK_SIZE_Y) {
                                chunkData[x][terrainHeight + th][z] = BLOCK_TYPES.WOOD;
                            }
                        }
                        // Leaves (simple cube for now)
                        const leafRadius = 2;
                        for (let ly = -1; ly <= 1; ly++) {
                            for (let lx = -leafRadius; lx <= leafRadius; lx++) {
                                for (let lz = -leafRadius; lz <= leafRadius; lz++) {
                                    // Simple cube shape, ignore corners maybe?
                                    if (Math.abs(lx) === leafRadius && Math.abs(lz) === leafRadius && ly !== 0) continue; // Trim corners

                                    const leafX = x + lx;
                                    const leafY = terrainHeight + treeHeight + ly;
                                    const leafZ = z + lz;

                                    // Check bounds within the current chunk for simplicity
                                    if (leafX >= 0 && leafX < CHUNK_SIZE_X &&
                                        leafY >= 0 && leafY < CHUNK_SIZE_Y &&
                                        leafZ >= 0 && leafZ < CHUNK_SIZE_Z) {
                                        // Only place leaves in air blocks, don't overwrite trunk
                                        if (chunkData[leafX][leafY][leafZ] === BLOCK_TYPES.AIR) {
                                            chunkData[leafX][leafY][leafZ] = BLOCK_TYPES.LEAVES;
                                        }
                                    }
                                     // TODO: Handle leaves crossing chunk boundaries
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return chunkData;
}

// Helper to check if a block outside the current chunk is solid
function isSolidNeighbor(worldX, worldY, worldZ) {
    if (worldY < 0 || worldY >= CHUNK_SIZE_Y) return false; // Treat out of bounds Y as air
    return isSolid(getBlock(worldX, worldY, worldZ));
}

// Optimized Meshing (Culled Faces)
function generateChunkMesh(chunkData, chunkX, chunkZ) {
    const chunkWorldX = chunkX * CHUNK_SIZE_X;
    const chunkWorldZ = chunkZ * CHUNK_SIZE_Z;

    const positions = [];
    const normals = [];
    const colors = []; // Store vertex colors
    const indices = [];
    let vertexIndex = 0;

    // Define vertices and normals for each face of a cube
    const faceVertices = [
        // Front face (positive Z)
        { pos: [-0.5, -0.5,  0.5], norm: [ 0,  0,  1], col: [1, 1, 1] },
        { pos: [ 0.5, -0.5,  0.5], norm: [ 0,  0,  1], col: [1, 1, 1] },
        { pos: [ 0.5,  0.5,  0.5], norm: [ 0,  0,  1], col: [1, 1, 1] },
        { pos: [-0.5,  0.5,  0.5], norm: [ 0,  0,  1], col: [1, 1, 1] },
        // Back face (negative Z)
        { pos: [ 0.5, -0.5, -0.5], norm: [ 0,  0, -1], col: [0.8, 0.8, 0.8] }, // Darker
        { pos: [-0.5, -0.5, -0.5], norm: [ 0,  0, -1], col: [0.8, 0.8, 0.8] },
        { pos: [-0.5,  0.5, -0.5], norm: [ 0,  0, -1], col: [0.8, 0.8, 0.8] },
        { pos: [ 0.5,  0.5, -0.5], norm: [ 0,  0, -1], col: [0.8, 0.8, 0.8] },
        // Top face (positive Y)
        { pos: [-0.5,  0.5,  0.5], norm: [ 0,  1,  0], col: [1, 1, 1] },
        { pos: [ 0.5,  0.5,  0.5], norm: [ 0,  1,  0], col: [1, 1, 1] },
        { pos: [ 0.5,  0.5, -0.5], norm: [ 0,  1,  0], col: [1, 1, 1] },
        { pos: [-0.5,  0.5, -0.5], norm: [ 0,  1,  0], col: [1, 1, 1] },
        // Bottom face (negative Y)
        { pos: [ 0.5, -0.5,  0.5], norm: [ 0, -1,  0], col: [0.6, 0.6, 0.6] }, // Darkest
        { pos: [-0.5, -0.5,  0.5], norm: [ 0, -1,  0], col: [0.6, 0.6, 0.6] },
        { pos: [-0.5, -0.5, -0.5], norm: [ 0, -1,  0], col: [0.6, 0.6, 0.6] },
        { pos: [ 0.5, -0.5, -0.5], norm: [ 0, -1,  0], col: [0.6, 0.6, 0.6] },
        // Right face (positive X)
        { pos: [ 0.5, -0.5,  0.5], norm: [ 1,  0,  0], col: [0.9, 0.9, 0.9] }, // Slightly darker
        { pos: [ 0.5, -0.5, -0.5], norm: [ 1,  0,  0], col: [0.9, 0.9, 0.9] },
        { pos: [ 0.5,  0.5, -0.5], norm: [ 1,  0,  0], col: [0.9, 0.9, 0.9] },
        { pos: [ 0.5,  0.5,  0.5], norm: [ 1,  0,  0], col: [0.9, 0.9, 0.9] },
        // Left face (negative X)
        { pos: [-0.5, -0.5, -0.5], norm: [-1,  0,  0], col: [0.7, 0.7, 0.7] }, // Darker
        { pos: [-0.5, -0.5,  0.5], norm: [-1,  0,  0], col: [0.7, 0.7, 0.7] },
        { pos: [-0.5,  0.5,  0.5], norm: [-1,  0,  0], col: [0.7, 0.7, 0.7] },
        { pos: [-0.5,  0.5, -0.5], norm: [-1,  0,  0], col: [0.7, 0.7, 0.7] },
    ];

    // Define indices for two triangles per face (quad)
    const faceIndices = [0, 1, 2, 0, 2, 3];

    for (let y = 0; y < CHUNK_SIZE_Y; y++) {
        for (let z = 0; z < CHUNK_SIZE_Z; z++) {
            for (let x = 0; x < CHUNK_SIZE_X; x++) {
                const blockType = chunkData[x][y][z];

                if (isSolid(blockType)) {
                    const blockColorRGB = new THREE.Color(BLOCK_COLORS[blockType] || 0xffffff);
                    const worldX = chunkWorldX + x;
                    const worldY = y;
                    const worldZ = chunkWorldZ + z;

                    // Check neighbors
                    const neighbors = [
                        isSolidNeighbor(worldX, worldY, worldZ + 1), // Front
                        isSolidNeighbor(worldX, worldY, worldZ - 1), // Back
                        isSolidNeighbor(worldX, worldY + 1, worldZ), // Top
                        isSolidNeighbor(worldX, worldY - 1, worldZ), // Bottom
                        isSolidNeighbor(worldX + 1, worldY, worldZ), // Right
                        isSolidNeighbor(worldX - 1, worldY, worldZ)  // Left
                    ];

                    // Add faces if neighbor is not solid (is air or transparent)
                    for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
                        if (!neighbors[faceIndex]) {
                            const faceOffset = faceIndex * 4;
                            const faceColorMultiplier = faceVertices[faceOffset].col; // Get base color multiplier for this face direction

                            for (let i = 0; i < 4; i++) {
                                const vertexData = faceVertices[faceOffset + i];
                                positions.push(vertexData.pos[0] + worldX + 0.5, vertexData.pos[1] + worldY + 0.5, vertexData.pos[2] + worldZ + 0.5);
                                normals.push(...vertexData.norm);
                                // Apply block color * face brightness multiplier
                                colors.push(
                                    blockColorRGB.r * faceColorMultiplier[0],
                                    blockColorRGB.g * faceColorMultiplier[1],
                                    blockColorRGB.b * faceColorMultiplier[2]
                                );
                            }
                            // Add indices for the quad
                            indices.push(
                                vertexIndex + faceIndices[0],
                                vertexIndex + faceIndices[1],
                                vertexIndex + faceIndices[2],
                                vertexIndex + faceIndices[3],
                                vertexIndex + faceIndices[4],
                                vertexIndex + faceIndices[5]
                            );
                            vertexIndex += 4; // Added 4 vertices
                        }
                    }
                }
            }
        }
    }

    if (positions.length === 0) {
        return null; // Return null or an empty group if chunk is empty
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); // Add color attribute
    geometry.setIndex(indices);

    // Material that uses vertex colors
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true, // Enable vertex colors
        // side: THREE.DoubleSide // Usually not needed with culled faces
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `chunk_${chunkX}_${chunkZ}`; // Optional: Name the mesh for debugging

    // --- Enable Shadows for the Chunk --- //
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // --------------------------------- //

    // Important: Mesh position is now (0,0,0) because vertex positions are already in world space
    // mesh.position.set(chunkWorldX, 0, chunkWorldZ); // Not needed

    return mesh;
}

// --- Player State --- Added
let playerVelocity = new THREE.Vector3();
let playerIsOnGround = false;
let playerCollider = new THREE.Box3(); // Bounding box for the player
// --- ADDED: Define collider offset relative to eye position ---
// Eyes are 1.8 blocks up a 2 block collider. Center is 1 block up.
// So center is 1.8 - 1.0 = 0.8 blocks BELOW eye level.
const playerColliderCenterOffsetY = -(PLAYER_HEIGHT / 2 - (PLAYER_HEIGHT - 1.8 * BLOCK_SIZE)); // -(1.0 - 0.2) = -0.8
let playerColliderHelper; // Visual helper for the collider
const playerMovement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sprinting: false // <<< ADDED
};

// --- Input Handling --- Refactored
document.addEventListener('keydown', (event) => {
    if (!isPointerLocked) return;

    // --- Prevent Browser Shortcuts --- //
    if (event.ctrlKey && event.code === 'KeyS') {
        event.preventDefault(); // Prevent saving the page
    } else if (event.ctrlKey && event.code === 'KeyW') {
        event.preventDefault(); // Prevent closing the tab
    } else if (event.ctrlKey && event.code === 'KeyR') {
        event.preventDefault(); // Prevent reloading the page
    } else if (event.ctrlKey && event.code === 'KeyD') {
        event.preventDefault(); // Prevent adding a bookmark
    }

    // --- Handle Player Movement Input --- //
    switch (event.code) {
        case 'KeyW': playerMovement.forward = true; break;
        case 'KeyA': playerMovement.left = true; break;
        case 'KeyS': playerMovement.backward = true; break;
        case 'KeyD': playerMovement.right = true; break;
        case 'Space': playerMovement.jump = true; break;
        case 'ControlLeft':
        case 'ControlRight': playerMovement.sprinting = true; break;

        // --- Hotbar Selection --- //
        case 'Digit1': updateSelectedSlot(0); break;
        case 'Digit2': updateSelectedSlot(1); break;
        case 'Digit3': updateSelectedSlot(2); break;
        case 'Digit4': updateSelectedSlot(3); break;
        case 'Digit5': updateSelectedSlot(4); break;
        case 'Digit6': updateSelectedSlot(5); break;
        case 'Digit7': updateSelectedSlot(6); break;
        case 'Digit8': updateSelectedSlot(7); break;
        case 'Digit9': updateSelectedSlot(8); break;
    }
});

document.addEventListener('keyup', (event) => {
    // No need to check if pointer is locked for keyup,
    // always reset state if a key is released
    switch (event.code) {
        case 'KeyW': playerMovement.forward = false; break;
        case 'KeyA': playerMovement.left = false; break;
        case 'KeyS': playerMovement.backward = false; break;
        case 'KeyD': playerMovement.right = false; break;
        case 'Space': playerMovement.jump = false; break; // Reset jump flag on release
        case 'ControlLeft':
        case 'ControlRight': playerMovement.sprinting = false; break;
    }
});

// Update the player's bounding box position
function updatePlayerCollider() {
    const playerObject = controls.object;
    const eyePosition = playerObject.position;
    const colliderCenter = eyePosition.clone().add(new THREE.Vector3(0, playerColliderCenterOffsetY, 0)); // Apply offset

    // Collider should be centered correctly relative to the eye position
    playerCollider.setFromCenterAndSize(
        colliderCenter, // Center the Box3 at the calculated offset
        new THREE.Vector3(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH)
    );

    // Update the helper if it exists
    // if (playerColliderHelper) { // <<< COMMENTED OUT
    //     playerColliderHelper.box = playerCollider;
    //     // playerColliderHelper.updateMatrixWorld(true); // Might be needed if helper doesn't update visually
    // } // <<< COMMENTED OUT
}

// --- Player Physics and Movement --- Refactored
function updatePlayerMovement(deltaTime) {
    // console.log(`--- Frame Start --- Delta: ${deltaTime.toFixed(4)}`);
    // console.log(`Start Velocity: X=${playerVelocity.x.toFixed(2)}, Y=${playerVelocity.y.toFixed(2)}, Z=${playerVelocity.z.toFixed(2)}`);
    // console.log(`Start Position: X=${playerObject?.position.x.toFixed(2)}, Y=${playerObject?.position.y.toFixed(2)}, Z=${playerObject?.position.z.toFixed(2)}`);

    const playerObject = controls.object;
    const isHighUp = playerObject.position.y > CHUNK_SIZE_Y - 5; // Log if near world top

    if (isHighUp) {
        console.log(`[High Alt Start] Pos: ${playerObject.position.x.toFixed(2)},${playerObject.position.y.toFixed(2)},${playerObject.position.z.toFixed(2)} Vel: ${playerVelocity.x.toFixed(2)},${playerVelocity.y.toFixed(2)},${playerVelocity.z.toFixed(2)}`);
    }

    if (!controls.isLocked) {
         // Apply friction even when paused/unlocked so player doesn't slide forever
        playerVelocity.x *= FRICTION_GROUND;
        playerVelocity.z *= FRICTION_GROUND;
        // Don't instantly stop vertical velocity unless grounded
        if (playerIsOnGround) {
            playerVelocity.y = 0;
        } else {
            // Still apply gravity when paused in air
            playerVelocity.y += GRAVITY * deltaTime;
        }
        return; // Don't process movement inputs if controls are locked
    }

    // --- Start of Physics ---
    playerIsOnGround = false; // <<< MOVED: Reset reliably at the start of physics calculation

    // Acceleration and friction depend on ground state (updated later in collision)
    // Speed depends on ground state AND sprinting
    let currentSpeed = PLAYER_SPEED_AIR; // Default to air speed
    let currentAcceleration = ACCELERATION_AIR;
    let currentFriction = FRICTION_AIR;
    // NOTE: Speed/Accel/Friction will be updated *after* Y collision check confirms ground state

    // --- 1. Calculate Input Direction ---
    const moveDirection = new THREE.Vector3();
    if (playerMovement.forward) moveDirection.z -= 1;
    if (playerMovement.backward) moveDirection.z += 1;
    if (playerMovement.left) moveDirection.x -= 1;
    if (playerMovement.right) moveDirection.x += 1;

    // Normalize diagonal movement
    if (moveDirection.lengthSq() > 0) { // Avoid normalizing zero vector
         moveDirection.normalize();
    }

    // Apply camera rotation to movement direction
    moveDirection.applyQuaternion(playerObject.quaternion);

    // --- 2. Calculate Target Velocity based on Input --- // <<< MODIFIED TO USE LATER SPEED
    // We'll calculate this *after* determining the correct speed based on ground state

    // --- 3. Apply Acceleration / Friction (Horizontal) --- // <<< MODIFIED
    // Horizontal acceleration/friction happens *after* ground check and speed determination

    // --- 4. Apply Gravity (Vertical) ---
    playerVelocity.y += GRAVITY * deltaTime;

    // --- 5. Calculate Potential Position Change ---
    const deltaPosition = playerVelocity.clone().multiplyScalar(deltaTime);
    // const potentialPosition = playerObject.position.clone().add(deltaPosition); // Less critical now

    if (isHighUp) {
        console.log(`[High Alt Pre-Collision] deltaPos: ${deltaPosition.x.toFixed(3)},${deltaPosition.y.toFixed(3)},${deltaPosition.z.toFixed(3)}`);
    }

    // --- 6. Collision Detection and Resolution (Corrected Collider Center) ---
    // playerIsOnGround = false; // <<< REMOVED: Moved to the top
    const epsilon = 0.001;

    // --- Resolve Y (Vertical) Collision FIRST ---
    const currentEyeY = playerObject.position.y;

    // Check for ground collision
    if (playerVelocity.y <= epsilon) {
        const groundCheckPos = playerObject.position.clone().add(new THREE.Vector3(0, deltaPosition.y, 0));
        const groundCollision = checkCollision(groundCheckPos, true);

        if (groundCollision) {
            const groundSurfaceY = groundCollision.blockPos.y + BLOCK_SIZE;
            const targetColliderBottomY = groundSurfaceY;
            const targetEyeY = targetColliderBottomY + (PLAYER_HEIGHT / 2) - playerColliderCenterOffsetY;
            const potentialEyePosY = currentEyeY + deltaPosition.y;
            const potentialColliderBottomY = potentialEyePosY + playerColliderCenterOffsetY - (PLAYER_HEIGHT / 2);

            // If moving down towards ground or already very close
            if (potentialColliderBottomY < targetColliderBottomY + epsilon * 2) { // Slightly increased epsilon buffer for landing check
                 deltaPosition.y = targetEyeY - currentEyeY;
                 playerVelocity.y = 0;
                 playerIsOnGround = true; // <<< SET GROUNDED STATE HERE
                 // console.log(`Ground collision/snap: TargetBottom=${targetColliderBottomY.toFixed(3)}, TargetEye=${targetEyeY.toFixed(3)}, Adjusted deltaY=${deltaPosition.y.toFixed(3)}`);
            }
             // Removed the separate 'else if (!playerIsOnGround)' block as the condition above now handles proximity snapping
        }
    }

    // Check for ceiling collision
    if (playerVelocity.y > 0) {
        const headCheckPos = playerObject.position.clone().add(new THREE.Vector3(0, deltaPosition.y, 0));
        const ceilingCollision = checkCollision(headCheckPos, false, true);

        if (ceilingCollision) {
            const ceilingBottomY = ceilingCollision.blockPos.y;
            const potentialEyePosY = currentEyeY + deltaPosition.y;
            const potentialColliderTopY = potentialEyePosY + playerColliderCenterOffsetY + (PLAYER_HEIGHT / 2);
            const targetColliderTopY = ceilingBottomY;

            if (potentialColliderTopY > targetColliderTopY - epsilon) {
                const requiredEyeChange = (targetColliderTopY - epsilon)
                                          - (PLAYER_HEIGHT / 2)
                                          - playerColliderCenterOffsetY
                                          - currentEyeY;
                deltaPosition.y = requiredEyeChange;
                playerVelocity.y = 0;
                 if (isHighUp) console.log(`[High Alt] Ceiling Collision Adjusted: TargetTop=${targetColliderTopY.toFixed(3)}, Adjusted deltaY=${deltaPosition.y.toFixed(3)}`);
                 // Note: No change to playerIsOnGround here
            }
        }
    }

    // --- Resolve X/Z (Horizontal) Collisions ---
    // TODO: Refine horizontal collision to potentially slide along walls instead of just stopping.
    // Check X Collision (using potentially adjusted deltaY)
    const horizontalCheckPosX = playerObject.position.clone().add(new THREE.Vector3(deltaPosition.x, deltaPosition.y, 0));
    let horizontalCollisionX = checkCollision(horizontalCheckPosX); // Generic check, not specific axis yet
    if (horizontalCollisionX) {
        // Determine penetration depth? Simplest: stop.
        if (isHighUp) console.log(`[High Alt] Horizontal X Collision Detected! Block: ${horizontalCollisionX.blockPos.x},${horizontalCollisionX.blockPos.y},${horizontalCollisionX.blockPos.z}`);
        deltaPosition.x = 0;
        playerVelocity.x = 0;
    }

    // Check Z Collision (using potentially adjusted deltaY and deltaX)
    const horizontalCheckPosZ = playerObject.position.clone().add(new THREE.Vector3(deltaPosition.x, deltaPosition.y, deltaPosition.z));
    let horizontalCollisionZ = checkCollision(horizontalCheckPosZ); // Generic check
     if (horizontalCollisionZ) {
        if (isHighUp) console.log(`[High Alt] Horizontal Z Collision Detected! Block: ${horizontalCollisionZ.blockPos.x},${horizontalCollisionZ.blockPos.y},${horizontalCollisionZ.blockPos.z}`);
        deltaPosition.z = 0;
        playerVelocity.z = 0;
    }

    // --- 7. Pre-Apply Clamp on Vertical Delta --- // <<< NEW STEP
    const maxEyeYForDelta = (CHUNK_SIZE_Y * BLOCK_SIZE) // Top world coordinate (absolute)
                           - (PLAYER_HEIGHT / 2)        // Adjust down by half height
                           - playerColliderCenterOffsetY // Adjust for collider offset
                           - epsilon;                   // Add epsilon buffer
    const potentialFinalEyeY = currentEyeY + deltaPosition.y;
    if (potentialFinalEyeY > maxEyeYForDelta) {
        if (isHighUp) console.log(`[High Alt Pre-Apply Clamp] Clamping deltaY from ${deltaPosition.y.toFixed(3)}`);
        deltaPosition.y = maxEyeYForDelta - currentEyeY; // Adjust delta to hit the limit exactly
        if (playerVelocity.y > 0) { // Stop velocity if clamped
            playerVelocity.y = 0;
        }
         if (isHighUp) console.log(`[High Alt Pre-Apply Clamp] Adjusted deltaY to ${deltaPosition.y.toFixed(3)}`);
    }

    // --- 8. Apply Final Position Update ---
    if (isHighUp) {
        console.log(`[High Alt Pre-Update] Final deltaPos: ${deltaPosition.x.toFixed(3)},${deltaPosition.y.toFixed(3)},${deltaPosition.z.toFixed(3)}`);
    }
    playerObject.position.add(deltaPosition);

    // --- 9. Sanity Check ---
     if (isNaN(playerObject.position.x) || isNaN(playerObject.position.y) || isNaN(playerObject.position.z) ||
         !isFinite(playerObject.position.x) || !isFinite(playerObject.position.y) || !isFinite(playerObject.position.z)) {
         console.error("!!! Invalid finalPosition calculated! Resetting position and velocity.", playerObject.position.clone());
         if (isHighUp) console.warn('[High Alt] Sanity Check Triggered!');
          // Avoid large jumps, try to reset to ground level at current X/Z
          const currentPos = playerObject.position;
          let safeY = CHUNK_SIZE_Y / 2; // Default safe Y
          const currentX = Math.floor(currentPos.x);
          const currentZ = Math.floor(currentPos.z);
          // Scan down from a reasonable height
          for (let y = CHUNK_SIZE_Y -1; y > 0; y--) {
              if (isSolid(getBlock(currentX, y - 1, currentZ))) {
                  // Found ground block below Y
                  safeY = y + 1.8 * BLOCK_SIZE; // Set eye level 1.8 above the surface
                  console.log(`Found ground for reset at [${currentX}, ${y-1}, ${currentZ}], setting Y to ${safeY}`);
                  break;
              }
          }
          console.log("Attempting reset to Y:", safeY);
          playerObject.position.set(currentPos.x, safeY, currentPos.z);
          playerVelocity.set(0,0,0);
     }

    // --- 10. Jumping --- (Uses the updated playerIsOnGround state)
    if (playerMovement.jump && playerIsOnGround) {
        playerVelocity.y = JUMP_VELOCITY;
        playerIsOnGround = false; // Player has left the ground
        // playerMovement.jump = false;
    }

    // --- 11. Update Player Collider ---
    updatePlayerCollider();

    // --- Update Speed/Accel/Friction based on Ground State --- //
    if (playerIsOnGround) {
        currentAcceleration = ACCELERATION_GROUND;
        currentFriction = FRICTION_GROUND;
        currentSpeed = PLAYER_SPEED_GROUND; // Base ground speed
    } else {
        // Already set to air values initially, but good to be explicit
        currentAcceleration = ACCELERATION_AIR;
        currentFriction = FRICTION_AIR;
        currentSpeed = PLAYER_SPEED_AIR; // Base air speed
    }

    // --- Sprinting Logic (Affects Speed and FOV) --- //
    const wantsToSprint = playerMovement.sprinting && playerMovement.forward;

    if (wantsToSprint) {
        currentSpeed *= SPRINT_MULTIPLIER; // Apply multiplier to current base speed (ground or air)
    }

    // --- Smooth FOV Adjustment --- //
    const targetFOV = wantsToSprint ? SPRINT_FOV : NORMAL_FOV;
    if (Math.abs(camera.fov - targetFOV) > 0.01) { // Add a small threshold to prevent constant updates
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, FOV_LERP_SPEED * deltaTime);
        camera.updateProjectionMatrix();
    }

    // --- Now Recalculate Target Velocity and Apply Horizontal Accel/Friction --- // <<< ADDED BACK
    const targetVelocityXZ = moveDirection.clone().multiplyScalar(currentSpeed);

    const deltaVelocityX = targetVelocityXZ.x - playerVelocity.x;
    const deltaVelocityZ = targetVelocityXZ.z - playerVelocity.z;

    playerVelocity.x += deltaVelocityX * currentAcceleration * deltaTime;
    playerVelocity.z += deltaVelocityZ * currentAcceleration * deltaTime;

    // Apply friction ALWAYS (using the correct friction for current state)
    playerVelocity.x *= currentFriction;
    playerVelocity.z *= currentFriction;

    // Remove or comment out debug logs if not needed anymore
    // console.log(`End Velocity: X=${playerVelocity.x.toFixed(2)}, Y=${playerVelocity.y.toFixed(2)}, Z=${playerVelocity.z.toFixed(2)}`);
    // console.log(`End Position: X=${playerObject.position.x.toFixed(2)}, Y=${playerObject.position.y.toFixed(2)}, Z=${playerObject.position.z.toFixed(2)}`);
    // console.log(`Player On Ground: ${playerIsOnGround}`);
    // console.log(`--- Frame End ---`);
}

// --- Collision Detection Helper --- Refined Logic
function checkCollision(targetPosition, checkBelowOnly = false, checkAboveOnly = false) {
    const potentialEyePosition = targetPosition.clone();
    const potentialColliderCenter = potentialEyePosition.clone().add(new THREE.Vector3(0, playerColliderCenterOffsetY, 0)); // Apply offset
    const epsilon = 0.001; // Small value for boundary checks

    const playerBox = new THREE.Box3().setFromCenterAndSize(
        potentialColliderCenter,
        new THREE.Vector3(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH)
    );

    // Calculate the range of block indices the player potentially intersects
    // Use floor(coord - epsilon) for max bounds to avoid checking blocks just touching the edge
    const minBlockX = Math.floor(playerBox.min.x + epsilon); // Add epsilon to min to ensure blocks containing the edge are included
    const maxBlockX = Math.floor(playerBox.max.x - epsilon);
    const minBlockZ = Math.floor(playerBox.min.z + epsilon);
    const maxBlockZ = Math.floor(playerBox.max.z - epsilon);

    let yStart, yEnd;

    // Determine the Y range to check
    if (checkBelowOnly) {
        // Check only the block layer index directly below the player's feet
        yStart = Math.floor(playerBox.min.y - epsilon);
        yEnd = yStart;
    } else if (checkAboveOnly) {
        // Check only the block layer index potentially containing or just above the player's head
        // If head is at 63.99, floor(63.99 + eps) = 63. Checks block 63.
        // If head is at 64.00, floor(64.00 + eps) = 64. Check block 64 (needs clamp).
        // If head is at 64.01, floor(64.01 + eps) = 64. Check block 64 (needs clamp).
        yStart = Math.floor(playerBox.max.y + epsilon); // Potential block index *at* or above head
        yEnd = yStart;
    } else {
        // General collision: check all block indices overlapping the player's Y range
        yStart = Math.floor(playerBox.min.y + epsilon);
        yEnd = Math.floor(playerBox.max.y - epsilon);
    }

    // Clamp final Y range to valid block indices [0, CHUNK_SIZE_Y - 1]
    yStart = Math.max(0, Math.min(CHUNK_SIZE_Y - 1, yStart));
    yEnd = Math.max(0, Math.min(CHUNK_SIZE_Y - 1, yEnd));

     // Ensure loop range is valid (yStart should not be greater than yEnd)
    if (yStart > yEnd) {
         return null; // If range is invalid (e.g., after clamping), no collision possible
    }

    // const isCheckingHigh = potentialEyePosition.y > CHUNK_SIZE_Y - 5; // Keep this commented out unless needed again


    for (let x = minBlockX; x <= maxBlockX; x++) {
        for (let y = yStart; y <= yEnd; y++) {
            for (let z = minBlockZ; z <= maxBlockZ; z++) {
                const blockType = getBlock(x, y, z);
                // if (isCheckingHigh && y >= CHUNK_SIZE_Y - 2) { // Keep logs commented out
                //     console.log(`  [CheckCollision High] Checking Block [${x}, ${y}, ${z}]. Type: ${blockType === BLOCK_TYPES.AIR ? 'AIR' : blockType}`);
                // }
                if (isSolid(blockType)) {
                    const blockBox = new THREE.Box3(
                        new THREE.Vector3(x, y, z),
                        new THREE.Vector3(x + BLOCK_SIZE, y + BLOCK_SIZE, z + BLOCK_SIZE)
                    );
                    if (playerBox.intersectsBox(blockBox)) {
                        // Collision detected! Return info about the block.
                        // if (isCheckingHigh) {
                        //     console.log(`  [CheckCollision High] INTERSECTION FOUND with Block [${x}, ${y}, ${z}]`);
                        // }
                        return { collided: true, blockPos: new THREE.Vector3(x, y, z) };
                    }
                }
            }
        }
    }
    return null; // No collision
}

// --- Game Loop ---
const clock = new THREE.Clock();
let lastPlayerPos = new THREE.Vector3(); // For movement check

function animate() {
    requestAnimationFrame(animate);
    // Clamp delta time more aggressively to potentially reduce tunneling
    const deltaTime = Math.min(0.05, clock.getDelta());

    const playerObject = controls.object;

    // Check for player movement
    const currentMovement = lastPlayerPos.distanceToSquared(playerObject.position);
    isMoving = playerIsOnGround && currentMovement > 0.0001; // Check if moving significantly on ground
    lastPlayerPos.copy(playerObject.position);

    // --- Sprint Offset calculation moved back inside if(isPointerLocked) --- //
    /* Calculation moved back inside if(isPointerLocked)
    const fovRange = SPRINT_FOV - NORMAL_FOV;
    let sprintProgress = 0;
    if (fovRange !== 0) {
        sprintProgress = THREE.MathUtils.clamp((camera.fov - NORMAL_FOV) / fovRange, 0, 1);
    }
    const sprintYOffset = sprintProgress * SPRINT_HAND_Y_OFFSET_MAX;
    */

    if (isPointerLocked) {
        updatePlayerMovement(deltaTime);

        // --- Calculate Sprint Offset based on FOV --- // Moved back inside
        const fovRange = SPRINT_FOV - NORMAL_FOV;
        let sprintProgress = 0;
        if (fovRange !== 0) {
            sprintProgress = THREE.MathUtils.clamp((camera.fov - NORMAL_FOV) / fovRange, 0, 1);
        }
        const sprintYOffset = sprintProgress * SPRINT_HAND_Y_OFFSET_MAX;

        // --- Hand Bobbing Animation --- //
        let bobOffsetX = 0;
        let bobOffsetY = 0;
        if (isMoving) {
            bobbingTime += deltaTime;
            bobOffsetY = Math.sin(bobbingTime * bobbingFrequency) * bobbingAmplitude;
        } else {
            bobbingTime = 0;
        }
        // ---------------------------- //

        // --- Hand Attack Animation --- //
        let attackOffsetX = 0;
        let attackOffsetY = 0;
        let attackOffsetZ = 0;
        if (isAttacking) {
            attackProgress += deltaTime * attackSpeed;
            const attackPhase = Math.sin(Math.min(attackProgress, Math.PI));
            attackOffsetZ = attackPhase * -attackDistance;
            if (attackProgress >= Math.PI) { isAttacking = false; attackProgress = 0; }
        }
        // ---------------------------- //

        // --- Hand Punch Shake Animation --- //
        let punchOffsetX = 0;
        let punchOffsetY = 0;
        if (isPunching) {
            punchProgress += deltaTime;
            const shakePhase = Math.sin(punchProgress * punchFrequency) * (1 - (punchProgress / punchDuration));
            punchOffsetX = shakePhase * punchAmplitude;
            punchOffsetY = shakePhase * punchAmplitude * 0.5;
            if (punchProgress >= punchDuration) { isPunching = false; punchProgress = 0; }
        }
        // ---------------------------- //

        // --- Combine Hand Offsets --- //
        let targetX = 0.45 + punchOffsetX;
        let targetY = defaultHandY + bobOffsetY + punchOffsetY + sprintYOffset;
        let targetZ = defaultHandZ + attackOffsetZ;

        // Smoothly return Y to default only if NOT moving AND NOT punching AND NOT sprinting significantly
        if (!isMoving && !isPunching && sprintProgress < 0.1) {
            handSprite.position.y = THREE.MathUtils.lerp(handSprite.position.y, defaultHandY + sprintYOffset, deltaTime * 10);
        } else {
            handSprite.position.y = targetY;
        }

        // Apply combined X and Z positions directly
        handSprite.position.x = targetX;
        handSprite.position.z = targetZ;

    } else {
        // When paused, still apply basic physics if needed (e.g., gravity if in air)
        // The logic inside updatePlayerMovement handles the !isLocked case now
        updatePlayerMovement(deltaTime);
        // Also reset bobbing when paused
        bobbingTime = 0;
        // Lerp hand back towards default position. DO NOT use sprintYOffset here.
        handSprite.position.y = THREE.MathUtils.lerp(handSprite.position.y, defaultHandY, deltaTime * 10);
        // Reset X and Z as well, as they might have punch/attack offsets
        handSprite.position.x = THREE.MathUtils.lerp(handSprite.position.x, 0.45, deltaTime * 10);
        handSprite.position.z = THREE.MathUtils.lerp(handSprite.position.z, defaultHandZ, deltaTime * 10);
    }

    renderer.render(scene, camera);
}

// --- Initialization ---
function initializeGame() {
    console.log("Initializing game world...");
    const loadedChunks = new Set(); // Keep track of meshes added to the scene

    // Initialize Hotbar Selection
    updateSelectedSlot(selectedHotbarIndex); // Ensure the initial slot (0) is visually selected

    // --- Add Hand Sprite to Camera --- //
    camera.add(handSprite);
    // -------------------------------- //

    // Generate and mesh initial chunks
    const loadRadius = 2; // Load 5x5 chunks centered on 0,0
    for(let cx = -loadRadius; cx <= loadRadius; cx++){
        for(let cz = -loadRadius; cz <= loadRadius; cz++){
            const chunkKey = getChunkKey(cx, cz);
            if (!world.has(chunkKey)) {
                const chunkData = generateChunkData(cx, cz);
                world.set(chunkKey, chunkData);
                const chunkMesh = generateChunkMesh(chunkData, cx, cz);
                if (chunkMesh) { // Only add if mesh is not null
                    scene.add(chunkMesh);
                    loadedChunks.add(chunkKey);
                }
            }
        }
    }

    // Find a suitable starting position (scan down from above center)
    const startX = 0.5; // Center of block 0
    const startZ = 0.5;
    let startY = CHUNK_SIZE_Y - 1; // Start scan from the top
    while (startY > 0 && !isSolid(getBlock(Math.floor(startX), startY, Math.floor(startZ)))) {
        startY--;
    }

    // Ensure a valid ground level was found
    if (startY <= 0) {
        console.warn("Could not find solid ground at spawn point (0, 0). Defaulting Y.");
        startY = Math.floor(CHUNK_SIZE_Y / 3); // Default to ~1/3 world height if scan fails
    }

    const groundLevelY = (startY + 1) * BLOCK_SIZE; // Y coordinate of the top surface of the ground block
    // const spawnY = groundLevelY + (PLAYER_HEIGHT / 2) + 0.1; // Place eyes half-height above ground + buffer (OLD)
    // New: Spawn eyes at the desired 1.8 block height + buffer
    const spawnY = groundLevelY + 1.8 * BLOCK_SIZE + 0.1;

    console.log(`Spawning player at X: ${startX * BLOCK_SIZE}, Y: ${spawnY}, Z: ${startZ * BLOCK_SIZE} (Ground found at Y=${startY})`);

    // Set position on camera directly, as PointerLockControls manipulates the camera
    camera.position.set(startX * BLOCK_SIZE, spawnY, startZ * BLOCK_SIZE);
    playerVelocity.set(0,0,0); // Reset velocity
    updatePlayerCollider(); // Set initial collider AFTER setting position
    lastPlayerPos.copy(camera.position); // Initialize last position for bobbing check

    // Add collider helper AFTER initial collider is set
    // playerColliderHelper = new THREE.Box3Helper(playerCollider, 0xffff00); // Yellow color // <<< COMMENTED OUT
    // scene.add(playerColliderHelper); // <<< ADDED: Add helper to scene // <<< COMMENTED OUT

    animate(); // Start the animation loop AFTER setting position
    console.log('WebCraft Clone Initialized (Refined Movement)');
}

initializeGame(); 