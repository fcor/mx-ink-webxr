import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VariableTubePainter } from './VariableTubePainter.js';

const canvas = document.querySelector('.webgl');
const fileInput = document.getElementById('drawingFile');
const status = document.getElementById('viewerStatus');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 1.6, 3);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;

const whiteboardCanvas = document.createElement('canvas');
const whiteboardContext = whiteboardCanvas.getContext('2d');
let whiteboardMesh;
let drawingGroup = new THREE.Group();
scene.add(drawingGroup);

function addTubeStroke(stroke) {
    if (!Array.isArray(stroke.points) || stroke.points.length < 2) return;

    const painter = new VariableTubePainter(Math.max((stroke.points.length - 1) * 48 + 1, 49));
    painter.moveTo(new THREE.Vector3(...stroke.points[0]));
    for (let index = 1; index < stroke.points.length; index++) {
        const point = new THREE.Vector3(...stroke.points[index]);
        painter.lineTo(point, Number(stroke.widths?.[index]) || 0.001);
    }
    const mesh = new THREE.Mesh(
        painter.geometry,
        new THREE.MeshBasicMaterial({ color: stroke.color || '#000000' })
    );
    mesh.frustumCulled = false;
    drawingGroup.add(mesh);
}

function loadDrawing(drawing) {
    if (drawing?.format !== 'mx-ink-drawing' || drawing.version !== 1 ||
        !drawing.whiteboard || !Array.isArray(drawing.whiteboardStrokes) || !Array.isArray(drawing.strokes)) {
        throw new Error('This file is not a supported MX Ink drawing.');
    }

    const board = drawing.whiteboard;
    if (!Number.isFinite(board.canvasWidth) || !Number.isFinite(board.canvasHeight) ||
        !Number.isFinite(board.width) || !Number.isFinite(board.height)) {
        throw new Error('The drawing file has invalid whiteboard dimensions.');
    }

    drawingGroup.removeFromParent();
    drawingGroup.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose();
    });
    drawingGroup = new THREE.Group();
    scene.add(drawingGroup);

    whiteboardCanvas.width = board.canvasWidth;
    whiteboardCanvas.height = board.canvasHeight;
    whiteboardContext.fillStyle = '#fff';
    whiteboardContext.fillRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
    for (const stroke of drawing.whiteboardStrokes) {
        if (!Array.isArray(stroke.points) || stroke.points.length < 2) continue;
        whiteboardContext.beginPath();
        whiteboardContext.moveTo(...stroke.points[0]);
        for (const point of stroke.points.slice(1)) whiteboardContext.lineTo(...point);
        whiteboardContext.strokeStyle = stroke.color;
        whiteboardContext.lineWidth = stroke.width;
        whiteboardContext.lineCap = 'round';
        whiteboardContext.lineJoin = 'round';
        whiteboardContext.stroke();
    }

    const texture = new THREE.CanvasTexture(whiteboardCanvas);
    const geometry = new THREE.PlaneGeometry(board.width, board.height);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    if (whiteboardMesh) {
        scene.remove(whiteboardMesh);
        whiteboardMesh.geometry.dispose();
        whiteboardMesh.material.map?.dispose();
        whiteboardMesh.material.dispose();
    }
    whiteboardMesh = new THREE.Mesh(geometry, material);
    whiteboardMesh.position.fromArray(board.position);
    whiteboardMesh.quaternion.fromArray(board.rotation);
    scene.add(whiteboardMesh);

    for (const stroke of drawing.strokes) addTubeStroke(stroke);

    controls.target.copy(whiteboardMesh.position);
    camera.position.copy(whiteboardMesh.position).add(new THREE.Vector3(0, 0.6, 2.5));
    controls.update();
    status.textContent = `Loaded ${drawing.strokes.length} 3D strokes`;
}

fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    if (!file) return;
    try {
        loadDrawing(JSON.parse(await file.text()));
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Unable to read drawing file.';
    }
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', async (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    try {
        loadDrawing(JSON.parse(await file.text()));
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Unable to read drawing file.';
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
});
