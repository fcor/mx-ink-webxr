import * as THREE from "three";
import { VariableTubePainter } from "./VariableTubePainter";
import { XRButton } from "three/examples/jsm/webxr/XRButton.js";
//import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HTMLMesh } from 'three/addons/interactive/HTMLMesh.js';
import { InteractiveGroup } from 'three/addons/interactive/InteractiveGroup.js';
import { WhiteboardMarkerConstraint } from "./WhiteboardMarkerConstraint";

let camera, scene, renderer;
let controller1, controller2;
// let controllerGrip1, controllerGrip2;
let stylus;
let strokes = [];
let painter = null;
let gamepad1;
let rearButtonPressed = false;
let rearButtonT0 = 0;
let primaryButtonPressed = false;
let paletteTouchActive = false;
let isDrawingOutsideWhiteboard = false;
let prevIsDrawing = false;

// Whiteboard drawing
let whiteboard;
let whiteboardCanvas, whiteboardCtx, canvasTexture;
let whiteboardInkColor = '#000000';
let drawWidth = 12;
let eraserWidth = 36;
let lastPoint = null;
const CANVAS_WIDTH = 2048;
const CANVAS_HEIGHT = 1024;
const DRAW_THRESHOLD = 0.002; // How close stylus needs to be to draw

let constraint; // WhiteboardMarkerConstraint
let stylus3dModel
let paletteMesh;
const paletteRaycaster = new THREE.Raycaster();

function pulseHaptic(duration = 60) {
  const actuator = gamepad1?.hapticActuators?.[0];
  actuator?.pulse?.(1, duration);
}

window.clearWhiteboard = () => {
  whiteboardCtx.fillStyle = 'white';
  whiteboardCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  if (canvasTexture) canvasTexture.needsUpdate = true;
  pulseHaptic(60);
}

function drawOnCanvas(from, to) {
  whiteboardCtx.beginPath();
  whiteboardCtx.moveTo(from.x, from.y);
  whiteboardCtx.lineTo(to.x, to.y);
  whiteboardCtx.strokeStyle = whiteboardInkColor;
  whiteboardCtx.lineWidth = whiteboardInkColor === "#FFFFFF" ? eraserWidth : drawWidth;
  whiteboardCtx.lineCap = 'round';
  whiteboardCtx.lineJoin = 'round';
  whiteboardCtx.stroke();
  // Tell three.js to update the texture
  if (canvasTexture) canvasTexture.needsUpdate = true;
}
// This function converts a 3D world position to 2D canvas coordinates
function getDrawingCoordinates(worldPosition) {
  // Check distance to whiteboard plane
  const whiteboardPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    new THREE.Vector3(0, 0, 1).applyQuaternion(whiteboard.quaternion),
    whiteboard.position
  );
  const distance = whiteboardPlane.distanceToPoint(worldPosition);

  if (Math.abs(distance) > DRAW_THRESHOLD) {
    return null;
  }

  // Project point onto the whiteboard plane
  const projectedPoint = new THREE.Vector3();
  whiteboardPlane.projectPoint(worldPosition, projectedPoint);

  // Convert world coordinates to the whiteboard's local coordinates
  const localPoint = whiteboard.worldToLocal(projectedPoint.clone());

  // Convert local coordinates (-width/2 to +width/2) to UV coordinates (0 to 1)
  const uv = new THREE.Vector2(
    (localPoint.x / whiteboard.geometry.parameters.width) + 0.5,
    (localPoint.y / whiteboard.geometry.parameters.height) + 0.5
  );

  if (uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) {
    return null; // Point is outside the whiteboard
  }

  // Convert UV coordinates to canvas coordinates
  return {
    x: uv.x * CANVAS_WIDTH,
    y: (1 - uv.y) * CANVAS_HEIGHT // Y is inverted in canvas
  };
}

const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};

init();

function setupUi() {
  // Add ray visualizers (lines) so users see where they point
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -0.5)]);
  const line = new THREE.Line(geometry);
  line.name = 'line';
  line.scale.z = 0.5;

  controller1.add(line.clone());
  controller2.add(line.clone());

  // Setup InteractiveGroup
  // This group handles the "translation" of 3D raycasts to 2D DOM events
  const interactionGroup = new InteractiveGroup(renderer, camera);
  scene.add(interactionGroup);

  // Listen to the controllers for interaction
  interactionGroup.listenToXRControllerEvents(controller1);
  interactionGroup.listenToXRControllerEvents(controller2);

  // Create the HTMLMesh
  const paletteEl = document.getElementById('color-palette');
  paletteMesh = new HTMLMesh(paletteEl);

  // Position the palette in 3D space (e.g., floating in front of user)
  paletteMesh.position.set(0, 0.75, -0.39);
  paletteMesh.scale.setScalar(0.5);
  paletteMesh.rotation.x = -0.2; // Tilt slightly up for ergonomics

  // Add the mesh to the interaction group, NOT directly to the scene
  interactionGroup.add(paletteMesh);
}

// UI actions
window.selectColor = (colorHex) => {
  let buttons = document.getElementsByClassName('color-btn');
  for (const button of buttons) {
    button.classList.remove('selected');
  }
  const buttonId = `colorButton_${colorHex.replace('#', '')}`;
  document.getElementById(buttonId).classList.toggle('selected');

  // Apply color to whiteboard
  whiteboardInkColor = colorHex;

  if (gamepad1) {
    pulseHaptic();
  }
};

function dispatchPaletteClick(uv) {
  paletteMesh.dispatchEvent({
    type: 'click',
    data: new THREE.Vector2(uv.x, 1 - uv.y)
  });
}

function updatePaletteInteraction() {
  if (!stylus || !gamepad1 || !paletteMesh) return false;

  const primaryPressed = gamepad1.buttons[4]?.pressed || gamepad1.buttons[4]?.value > 0.5;
  if (primaryPressed && !primaryButtonPressed) {
    paletteRaycaster.setFromXRController(stylus);
    const [intersection] = paletteRaycaster.intersectObject(paletteMesh, false);
    if (intersection) dispatchPaletteClick(intersection.uv);
  }
  primaryButtonPressed = primaryPressed;

  const localTipPosition = paletteMesh.worldToLocal(stylus.position.clone());
  const { width, height } = paletteMesh.geometry.parameters;
  const touchingPalette = Math.abs(localTipPosition.z) <= 0.02 &&
    Math.abs(localTipPosition.x) <= width / 2 &&
    Math.abs(localTipPosition.y) <= height / 2;

  if (touchingPalette && !paletteTouchActive) {
    dispatchPaletteClick(new THREE.Vector2(
      localTipPosition.x / width + 0.5,
      localTipPosition.y / height + 0.5
    ));
  }
  paletteTouchActive = touchingPalette;

  return touchingPalette;
}

function init() {
  const canvas = document.querySelector("canvas.webgl");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 50);
  camera.position.set(0, 1.6, 3);

  const grid = new THREE.GridHelper(4, 1, 0x111111, 0x111111);
  scene.add(grid);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 2));

  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(0, 2, 2);
  scene.add(light);

  renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  renderer.setPixelRatio(window.devicePixelRatio, 2);
  renderer.setSize(sizes.width, sizes.height);
  renderer.setAnimationLoop(animate);
  renderer.xr.enabled = true;
  document.body.appendChild(XRButton.createButton(renderer, { optionalFeatures: ["unbounded"] }));

  // const controllerModelFactory = new XRControllerModelFactory();

  controller1 = renderer.xr.getController(0);
  controller1.addEventListener("connected", onControllerConnected);
  controller1.addEventListener("selectstart", onSelectStart);
  controller1.addEventListener("selectend", onSelectEnd);
  // controllerGrip1 = renderer.xr.getControllerGrip(0);
  // controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
  // scene.add(controllerGrip1);
  scene.add(controller1);

  controller2 = renderer.xr.getController(1);
  controller2.addEventListener("connected", onControllerConnected);
  controller2.addEventListener("selectstart", onSelectStart);
  controller2.addEventListener("selectend", onSelectEnd);
  // controllerGrip2 = renderer.xr.getControllerGrip(1);
  // controllerGrip2.add(controllerModelFactory.createControllerModel(controllerGrip2));
  // scene.add(controllerGrip2);
  scene.add(controller2);


  // --- Whiteboard Canvas ---
  whiteboardCanvas = document.createElement('canvas');
  whiteboardCanvas.width = CANVAS_WIDTH;
  whiteboardCanvas.height = CANVAS_HEIGHT;
  whiteboardCtx = whiteboardCanvas.getContext('2d');

  // Initial clear
  clearWhiteboard();

  canvasTexture = new THREE.CanvasTexture(whiteboardCanvas);

  // --- Whiteboard 3D Object ---
  const whiteboardGeometry = new THREE.PlaneGeometry(1, 0.5);
  const whiteboardMaterial = new THREE.MeshStandardMaterial({
    map: canvasTexture,
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0.1
  });
  whiteboard = new THREE.Mesh(whiteboardGeometry, whiteboardMaterial);
  whiteboard.position.set(0, 1.0, -0.4); // Position in 3D space
  scene.add(whiteboard);

  // --- Whiteboard constraint ---
  constraint = new WhiteboardMarkerConstraint({
    whiteboardSize: new THREE.Vector3(whiteboardGeometry.width, whiteboardGeometry.height, 0),
    whiteboardPosition: new THREE.Vector3(whiteboard.position.x, whiteboard.position.y, whiteboard.position.z),
    whiteboardRotation: new THREE.Quaternion(),
    markerLength: 0.16
  });

  // --- Load MX Ink 3D model ---
  // Could use the model from the XR Controller Model Factory, but this makes it easier to 
  // handle constrained position when touching the virtual whiteboard
  const loader = new GLTFLoader();
  loader.load(
    "./logitech_mx_ink.glb",
    (glb) => {
      console.log(glb);
      stylus3dModel = new THREE.Group();
      const mxink = glb.scene;
      mxink.rotateY(Math.PI);
      stylus3dModel.add(mxink);
      scene.add(stylus3dModel);
    },
    function (xhr) {
      console.log((xhr.loaded / xhr.total) * 100 + "% loaded");
    },
    function (error) {
      console.log("An error happened:", error);
    }
  );

  setupUi();
}

window.addEventListener("resize", () => {
  // Update sizes
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  // Update camera
  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();

  // Update renderer
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

function initVariableTubePainter() {
  // 1. Create a new Painter logic instance
  painter = new VariableTubePainter();

  // 2. Pick a random neon color
  const color = new THREE.Color(whiteboardInkColor);

  // 3. Create Material
  const material = new THREE.MeshBasicMaterial({
    color: color
  });

  // 4. Create Mesh and add to scene
  const mesh = new THREE.Mesh(painter.geometry, material);
  mesh.frustumCulled = false; // Important for dynamic geometry

  scene.add(mesh);

  painter.mesh = mesh;

  strokes.push(painter);

  // Initialize the first point
  painter.moveTo(stylus.position);
}

function animate() {
  if (gamepad1) {
    const touchingPalette = updatePaletteInteraction();
    prevIsDrawing = isDrawingOutsideWhiteboard;
    // stylus inputs: primary and/or tip is active
    isDrawingOutsideWhiteboard = !touchingPalette &&
      (gamepad1.buttons[5].value > 0 || gamepad1.buttons[4].value > 0);
    // debugGamepad(gamepad1);

    const constrainedPose = constraint.getVisibleMarkerPose({
      position: stylus.position,
      rotation: stylus.quaternion
    });

    // Update stylus pose
    stylus3dModel.position.copy(constrainedPose.tipPosition);
    stylus3dModel.rotation.setFromQuaternion(constrainedPose.rotation);

    const currentPoint = getDrawingCoordinates(constrainedPose.tipPosition);
    if (lastPoint && currentPoint) {
      drawOnCanvas(lastPoint, currentPoint);
      isDrawingOutsideWhiteboard = false; // do not draw in 3D
    }

    // Update lastPoint for the next move.
    lastPoint = currentPoint;

    if (isDrawingOutsideWhiteboard && !prevIsDrawing) {
      initVariableTubePainter();
    }
  }

  handleDrawing(stylus);

  if (gamepad1) {
    if (gamepad1.buttons[1].value && !rearButtonPressed) {
      rearButtonT0 = performance.now();
      let stroke = strokes.pop();
      if (stroke) {
        stroke.mesh.removeFromParent();
        stroke = undefined;

        pulseHaptic(80);
      }
    }

    rearButtonPressed = gamepad1.buttons[1].value;

    if (rearButtonPressed) {
      const timeSinceButtonPressed = performance.now() - rearButtonT0;
      if (timeSinceButtonPressed > 1500 && strokes.length > 0) {
        strokes.forEach((stroke) => {
          stroke.mesh.removeFromParent();
          stroke = undefined;
        });
        strokes = [];
        pulseHaptic(200);
      }
    }
  }
  // Render
  renderer.render(scene, camera);
}

function handleDrawing(controller) {
  if (!controller) return;

  const userData = controller.userData;

  if (gamepad1) {
    if (isDrawingOutsideWhiteboard) {
      if (painter) {
        // Update the stroke
        const width = Math.max(gamepad1.buttons[5].value, gamepad1.buttons[4].value);
        painter.lineTo(stylus.position, width * 0.01);
      }
    }
  }
}

function onControllerConnected(e) {
  if (e.data.profiles.includes("logitech-mx-ink")) {
    stylus = e.target;
    gamepad1 = e.data.gamepad;
  }
}

function onSelectStart(e) {
  console.log(`onSelectStart`);
  this.userData.isSelecting = true;
  if (e.target !== stylus) return;
}

function onSelectEnd() {
  console.log(`onSelectEnd`);
  this.userData.isSelecting = false;
}

// MX Ink button indices:
// 5: tip (float)
// 0: front (bool)
// 4: middle (float)
// 1: rear (bool)
function debugGamepad(gamepad) {
  gamepad.buttons.forEach((btn, index) => {
    if (btn.pressed) {
      console.log(`BTN ${index} - Pressed: ${btn.pressed} - Touched: ${btn.touched} - Value: ${btn.value}`);
    }

    if (btn.touched) {
      console.log(`BTN ${index} - Pressed: ${btn.pressed} - Touched: ${btn.touched} - Value: ${btn.value}`);
    }
  });
}
