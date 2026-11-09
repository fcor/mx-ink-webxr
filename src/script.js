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
let whiteboardStrokes = [];
let activeWhiteboardStroke = null;
let hasUnsavedChanges = false;
let isSaveFeedbackActive = false;
let saveFeedbackTimeout;
const SAVE_FEEDBACK_DURATION = 350;
const CANVAS_WIDTH = 2048;
const CANVAS_HEIGHT = 1024;
const DRAW_THRESHOLD = 0.002; // How close stylus needs to be to draw
const STROKE_PICK_RADIUS = 0.02;
const STROKE_HIGHLIGHT_DELAY = 500;

let constraint; // WhiteboardMarkerConstraint
let stylus3dModel
let paletteMesh;
let paletteControlBounds = [];
const paletteRaycaster = new THREE.Raycaster();
const strokeHighlightColor = new THREE.Color(0xffffff);
const strokeLocalPoint = new THREE.Vector3();
const strokeSegment = new THREE.Vector3();
const strokeToPoint = new THREE.Vector3();
const strokeClosestPoint = new THREE.Vector3();
let frontButtonPressed = false;
let activeStrokeGrab = null;
let undoActions = [];

function pulseHaptic(duration = 60) {
  const actuator = gamepad1?.hapticActuators?.[0];
  actuator?.pulse?.(1, duration);
}

function hasDrawingInScene() {
  return whiteboardStrokes.length > 0 || strokes.some((stroke) => stroke.points.length > 1);
}

function updateSaveButton() {
  const saveButton = document.getElementById('saveDrawing');
  if (!saveButton) return;

  const hasDrawing = hasDrawingInScene();
  const canSave = hasUnsavedChanges && hasDrawing;
  saveButton.disabled = !canSave && !isSaveFeedbackActive;
  const label = isSaveFeedbackActive
    ? 'Saving drawing'
    : canSave ? 'Save drawing as JSON'
      : hasUnsavedChanges && !hasDrawing ? 'No drawing to save' : 'No new drawing to save';
  saveButton.title = label;
  saveButton.setAttribute('aria-label', label);
}

function markDrawingChanged() {
  const saveButton = document.getElementById('saveDrawing');
  const needsRefresh = !hasUnsavedChanges || saveButton?.disabled;
  hasUnsavedChanges = true;
  if (needsRefresh) updateSaveButton();
}

window.clearWhiteboard = () => {
  const hadWhiteboardStrokes = whiteboardStrokes.length > 0;
  whiteboardCtx.fillStyle = 'white';
  whiteboardCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  whiteboardStrokes = [];
  activeWhiteboardStroke = null;
  if (canvasTexture) canvasTexture.needsUpdate = true;
  if (hadWhiteboardStrokes) markDrawingChanged();
  pulseHaptic(60);
}

function drawOnCanvas(from, to) {
  const lineWidth = whiteboardInkColor === "#FFFFFF" ? eraserWidth : drawWidth;
  const previousPoint = activeWhiteboardStroke?.points.at(-1);
  if (!activeWhiteboardStroke || activeWhiteboardStroke.color !== whiteboardInkColor ||
    activeWhiteboardStroke.width !== lineWidth || previousPoint.x !== from.x || previousPoint.y !== from.y) {
    activeWhiteboardStroke = {
      color: whiteboardInkColor,
      width: lineWidth,
      points: [[from.x, from.y]]
    };
    whiteboardStrokes.push(activeWhiteboardStroke);
  }
  activeWhiteboardStroke.points.push([to.x, to.y]);
  markDrawingChanged();

  whiteboardCtx.beginPath();
  whiteboardCtx.moveTo(from.x, from.y);
  whiteboardCtx.lineTo(to.x, to.y);
  whiteboardCtx.strokeStyle = whiteboardInkColor;
  whiteboardCtx.lineWidth = lineWidth;
  whiteboardCtx.lineCap = 'round';
  whiteboardCtx.lineJoin = 'round';
  whiteboardCtx.stroke();
  // Tell three.js to update the texture
  if (canvasTexture) canvasTexture.needsUpdate = true;
}

window.saveDrawing = () => {
  if (!hasUnsavedChanges || !hasDrawingInScene() || isSaveFeedbackActive) return;

  isSaveFeedbackActive = true;
  const saveButton = document.getElementById('saveDrawing');
  saveButton?.classList.add('selected');
  updateSaveButton();
  pulseHaptic();

  try {
    const drawing = {
      format: 'mx-ink-drawing',
      version: 1,
      whiteboard: {
        canvasWidth: CANVAS_WIDTH,
        canvasHeight: CANVAS_HEIGHT,
        width: whiteboard.geometry.parameters.width,
        height: whiteboard.geometry.parameters.height,
        position: whiteboard.position.toArray(),
        rotation: whiteboard.quaternion.toArray()
      },
      whiteboardStrokes,
      strokes: strokes.filter((stroke) => stroke.points.length > 1).map((stroke) => {
        stroke.mesh.updateWorldMatrix(true, false);
        return {
          color: `#${stroke.originalColor.getHexString()}`,
          points: stroke.points.map((point) => stroke.mesh.localToWorld(point.clone()).toArray()),
          widths: stroke.widths
        };
      })
    };
    const blob = new Blob([JSON.stringify(drawing, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mx-ink-drawing-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    hasUnsavedChanges = false;
  } catch (error) {
    console.error('Unable to save drawing:', error);
  } finally {
    window.clearTimeout(saveFeedbackTimeout);
    saveFeedbackTimeout = window.setTimeout(() => {
      isSaveFeedbackActive = false;
      saveButton?.classList.remove('selected');
      updateSaveButton();
    }, SAVE_FEEDBACK_DURATION);
  }
};

updateSaveButton();
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
  const paletteRect = paletteEl.getBoundingClientRect();
  paletteControlBounds = Array.from(paletteEl.querySelectorAll('button'), (button) => {
    const rect = button.getBoundingClientRect();
    return {
      left: (rect.left - paletteRect.left) / paletteRect.width,
      right: (rect.right - paletteRect.left) / paletteRect.width,
      top: (rect.top - paletteRect.top) / paletteRect.height,
      bottom: (rect.bottom - paletteRect.top) / paletteRect.height
    };
  });
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

  paletteRaycaster.setFromXRController(stylus);
  const [intersection] = paletteRaycaster.intersectObject(paletteMesh, false);
  const paletteX = intersection?.uv.x;
  const paletteY = intersection ? 1 - intersection.uv.y : null;
  const pointingAtControl = intersection && paletteControlBounds.some((bounds) =>
    paletteX >= bounds.left && paletteX <= bounds.right &&
    paletteY >= bounds.top && paletteY <= bounds.bottom
  );

  const primaryPressed = gamepad1.buttons[4]?.pressed || gamepad1.buttons[4]?.value > 0.5;
  if (primaryPressed && !primaryButtonPressed) {
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

  return touchingPalette || pointingAtControl;
}

function getStrokeDistanceSquared(stroke, worldPosition) {
  const points = stroke.points;
  if (!points.length) return Infinity;

  stroke.mesh.worldToLocal(strokeLocalPoint.copy(worldPosition));
  if (stroke.boundingBox.distanceToPoint(strokeLocalPoint) > STROKE_PICK_RADIUS) return Infinity;

  let minimumDistanceSquared = strokeLocalPoint.distanceToSquared(points[0]);
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    strokeSegment.subVectors(end, start);
    const segmentLengthSquared = strokeSegment.lengthSq();
    if (segmentLengthSquared === 0) continue;

    const amount = THREE.MathUtils.clamp(
      strokeToPoint.subVectors(strokeLocalPoint, start).dot(strokeSegment) / segmentLengthSquared,
      0,
      1
    );
    strokeClosestPoint.copy(start).addScaledVector(strokeSegment, amount);
    minimumDistanceSquared = Math.min(
      minimumDistanceSquared,
      strokeClosestPoint.distanceToSquared(strokeLocalPoint)
    );
  }

  return minimumDistanceSquared;
}

function setStrokeHighlighted(stroke, highlighted) {
  if (stroke.isHighlighted === highlighted) return;

  if (highlighted) {
    stroke.mesh.material.color.copy(stroke.originalColor).lerp(strokeHighlightColor, 0.25);
  } else {
    stroke.mesh.material.color.copy(stroke.originalColor);
  }
  stroke.isHighlighted = highlighted;
}

function updateStrokeHighlights(tipPosition) {
  if (activeStrokeGrab) return;

  const now = performance.now();
  const radiusSquared = STROKE_PICK_RADIUS * STROKE_PICK_RADIUS;
  let highlightedNewStroke = false;
  for (const stroke of strokes) {
    if (stroke === painter) {
      stroke.hoverStartedAt = null;
      setStrokeHighlighted(stroke, false);
      continue;
    }

    if (getStrokeDistanceSquared(stroke, tipPosition) <= radiusSquared) {
      if (stroke.hoverStartedAt === null) stroke.hoverStartedAt = now;
      if (!stroke.isHighlighted && now - stroke.hoverStartedAt >= STROKE_HIGHLIGHT_DELAY) {
        setStrokeHighlighted(stroke, true);
        highlightedNewStroke = true;
      }
    } else {
      stroke.hoverStartedAt = null;
      setStrokeHighlighted(stroke, false);
    }
  }

  if (highlightedNewStroke) pulseHaptic();
}

function beginStrokeGrab(tipPosition) {
  if (activeStrokeGrab || isDrawingOutsideWhiteboard || paletteTouchActive) return;

  const radiusSquared = STROKE_PICK_RADIUS * STROKE_PICK_RADIUS;
  const selectedStrokes = strokes.filter((stroke) =>
    stroke !== painter &&
    stroke.isHighlighted &&
    getStrokeDistanceSquared(stroke, tipPosition) <= radiusSquared
  );
  if (!selectedStrokes.length) return;

  const selectedSet = new Set(selectedStrokes);
  const entries = selectedStrokes.map((stroke) => {
    stroke.mesh.updateWorldMatrix(true, false);
    return { stroke, originalWorldMatrix: stroke.mesh.matrixWorld.clone() };
  });

  for (const stroke of strokes) {
    if (!selectedSet.has(stroke)) setStrokeHighlighted(stroke, false);
    stroke.hoverStartedAt = null;
  }
  for (const { stroke } of entries) stylus.attach(stroke.mesh);
  activeStrokeGrab = entries;
}

function finishStrokeGrab() {
  if (!activeStrokeGrab) return;

  const movedEntries = [];
  for (const entry of activeStrokeGrab) {
    scene.attach(entry.stroke.mesh);
    entry.stroke.mesh.updateWorldMatrix(true, false);
    const currentMatrix = entry.stroke.mesh.matrixWorld;
    const changed = currentMatrix.elements.some((value, index) =>
      Math.abs(value - entry.originalWorldMatrix.elements[index]) > 0.0001
    );
    if (changed) movedEntries.push(entry);
    setStrokeHighlighted(entry.stroke, false);
  }

  if (movedEntries.length) undoActions.push({ type: 'move', entries: movedEntries });
  if (movedEntries.length) markDrawingChanged();
  for (const stroke of strokes) stroke.hoverStartedAt = null;
  activeStrokeGrab = null;
}

function restoreStrokeWorldMatrix(stroke, worldMatrix) {
  if (stroke.mesh.parent !== scene) scene.attach(stroke.mesh);
  worldMatrix.decompose(stroke.mesh.position, stroke.mesh.quaternion, stroke.mesh.scale);
  stroke.mesh.updateMatrix();
  stroke.mesh.updateMatrixWorld(true);
  setStrokeHighlighted(stroke, false);
  stroke.hoverStartedAt = null;
}

function undoLastAction() {
  if (activeStrokeGrab) finishStrokeGrab();

  const action = undoActions.pop();
  if (!action) return;

  if (action.type === 'move') {
    for (const entry of action.entries) {
      restoreStrokeWorldMatrix(entry.stroke, entry.originalWorldMatrix);
    }
  } else {
    const strokeIndex = strokes.indexOf(action.stroke);
    if (strokeIndex !== -1) strokes.splice(strokeIndex, 1);
    action.stroke.mesh.removeFromParent();
    setStrokeHighlighted(action.stroke, false);
    if (painter === action.stroke) {
      painter = null;
      isDrawingOutsideWhiteboard = false;
    }
  }
  markDrawingChanged();
  pulseHaptic(80);
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
  painter.originalColor = color.clone();
  painter.hoverStartedAt = null;
  painter.isHighlighted = false;

  // 4. Create Mesh and add to scene
  const mesh = new THREE.Mesh(painter.geometry, material);
  mesh.frustumCulled = false; // Important for dynamic geometry

  scene.add(mesh);

  painter.mesh = mesh;

  strokes.push(painter);
  undoActions.push({ type: 'create', stroke: painter });

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
    } else if (!currentPoint) {
      activeWhiteboardStroke = null;
    }

    // Update lastPoint for the next move.
    lastPoint = currentPoint;

    if (prevIsDrawing && !isDrawingOutsideWhiteboard) painter = null;
    if (isDrawingOutsideWhiteboard && !prevIsDrawing) {
      initVariableTubePainter();
    }
  }

  handleDrawing(stylus);

  if (gamepad1) {
    updateStrokeHighlights(stylus.position);

    const frontPressed = gamepad1.buttons[0]?.pressed || gamepad1.buttons[0]?.value > 0.5;
    if (frontPressed && !frontButtonPressed) beginStrokeGrab(stylus.position);
    if (!frontPressed && frontButtonPressed) finishStrokeGrab();
    frontButtonPressed = frontPressed;

    if (gamepad1.buttons[1].value && !rearButtonPressed) {
      rearButtonT0 = performance.now();
      undoLastAction();
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
        undoActions = [];
        activeStrokeGrab = null;
        painter = null;
        isDrawingOutsideWhiteboard = false;
        markDrawingChanged();
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
        const pointCount = painter.points.length;
        painter.lineTo(stylus.position, width * 0.01);
        if (painter.points.length > pointCount) markDrawingChanged();
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
