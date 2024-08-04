import * as THREE from "three";
import { TubePainter } from "three/examples/jsm/misc/TubePainter.js";
import { XRButton } from "three/examples/jsm/webxr/XRButton.js";
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import testVertexShader from "./shaders/test/vertex.glsl";
import testFragmentShader from "./shaders/test/fragment.glsl";

let camera, scene, renderer;
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let material;
let painter1;
let gamepad1;

let isDrawing = false;
let prevIsDrawing = false;

const cursor = new THREE.Vector3();
const clock = new THREE.Clock();

const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};

init();

function init() {
  const canvas = document.querySelector("canvas.webgl");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 50);
  camera.position.set(0, 1.6, 3);

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/draco/");

  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);
  const grid = new THREE.GridHelper(4, 1, 0x111111, 0x111111);
  scene.add(grid);

  scene.add(new THREE.HemisphereLight(0x888877, 0x777788, 3));

  const light = new THREE.DirectionalLight(0xffffff, 1.5);
  light.position.set(0, 4, 0);
  scene.add(light);

  // const shaderMat = new THREE.ShaderMaterial({
  //   vertexShader: testVertexShader,
  //   fragmentShader: testFragmentShader,
  //   side: THREE.DoubleSide,
  //   uniforms: {
  //     uTime: { value: 0 },
  //   },
  // });

  const material = new THREE.MeshNormalMaterial({
    flatShading: true,
    side: THREE.DoubleSide,
  });

  const geometry = new THREE.CylinderGeometry(0.005, 0.005, 0.05);
  const mesh = new THREE.Mesh(geometry, material);
  // mesh.position.set(0, 1.5, 0);
  // scene.add(mesh);

  painter1 = new TubePainter();
  painter1.mesh.material = material;
  painter1.setSize(0.1);

  scene.add(painter1.mesh);

  const painter2 = new TubePainter();
  scene.add(painter2.mesh);

  renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  renderer.setPixelRatio(window.devicePixelRatio, 2);
  renderer.setSize(sizes.width, sizes.height);
  renderer.setAnimationLoop(animate);
  renderer.xr.enabled = true;
  document.body.appendChild(
    XRButton.createButton(
      renderer
      //   {
      //   optionalFeatures: ["depth-sensing"],
      //   depthSensing: { usagePreference: ["gpu-optimized"], dataFormatPreference: [] },
      // }
    )
  );

  const controllerModelFactory = new XRControllerModelFactory();

  const pivot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.001, 3));
  pivot.name = "pivot";
  // pivot.position.z = 0.05;

  const group = new THREE.Group();
  group.add(pivot);

  controller1 = renderer.xr.getController(0);
  controller1.addEventListener("connected", onControllerConnected);
  controller1.addEventListener("selectstart", onSelectStart);
  controller1.addEventListener("selectend", onSelectEnd);
  controller1.addEventListener("squeezestart", onSqueezeStart);
  controller1.addEventListener("squeezeend", onSqueezeEnd);
  controller1.userData.painter = painter1;
  // controllerGrip1 = renderer.xr.getControllerGrip(0);
  // controllerGrip1.add(stylus);
  // scene.add(controllerGrip1);
  scene.add(controller1);

  gltfLoader.load("/models/stylus3.glb", (gltf) => {
    // gltfLoader.load("https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-trigger/right.glb",
    // (gltf) => {
    controllerGrip1 = renderer.xr.getControllerGrip(0);
    controllerGrip1.add(gltf.scene);
    scene.add(controllerGrip1);
  });

  controller2 = renderer.xr.getController(1);
  controller2.addEventListener("selectstart", onSelectStart);
  controller2.addEventListener("selectend", onSelectEnd);
  controller2.addEventListener("squeezestart", onSqueezeStart);
  controller2.addEventListener("squeezeend", onSqueezeEnd);
  controller2.userData.painter = painter2;
  controllerGrip2 = renderer.xr.getControllerGrip(1);
  controllerGrip2.add(controllerModelFactory.createControllerModel(controllerGrip2));
  scene.add(controllerGrip2);
  scene.add(controller2);

  // controller1.add(group.clone());
  // controller2.add(group.clone());
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

function animate() {
  // const elapsedTime = clock.getElapsedTime();
  // material.uniforms.uTime.value = elapsedTime;
  // generateCylindricalUVs(painter1.mesh.geometry);

  // gamepad1?.buttons.forEach((btn, index) => {
  //   if (btn.pressed) {
  //     console.log(`BTN ${index} - Pressed: ${btn.pressed} - Touched: ${btn.touched} - Value: ${btn.value}`);
  //   }
  // });

  if (gamepad1 && gamepad1.axes) {
    prevIsDrawing = isDrawing;
    isDrawing = gamepad1.axes[2] > 0;

    if (isDrawing && !prevIsDrawing) {
      const pivot = controllerGrip1.getObjectByName("mx_ink_tip");
      cursor.setFromMatrixPosition(pivot.matrixWorld);
      painter1.moveTo(cursor);
    }
  }

  handleController(controller1);

  // Render
  renderer.render(scene, camera);
}

function handleController(controller) {
  controller.updateMatrixWorld(true);

  const userData = controller.userData;
  const painter = userData.painter;

  if (gamepad1) {
    const pivot = controllerGrip1.getObjectByName("mx_ink_tip");
    cursor.setFromMatrixPosition(pivot.matrixWorld);

    if (userData.isSelecting === true) {
      painter.lineTo(cursor);
      painter.update();
    }

    if (isDrawing) {
      painter.lineTo(cursor);
      painter.update();
    }
  }
}
function onSqueezeStart(e) {
  console.log(e);
}
function onSqueezeEnd(e) {}

function onControllerConnected(e) {
  gamepad1 = e.data.gamepad;
}

function onSelectStart(e) {
  console.log(e);
  this.updateMatrixWorld(true);

  const pivot = this.getObjectByName("pivot");
  cursor.setFromMatrixPosition(pivot.matrixWorld);

  const painter = this.userData.painter;
  painter.moveTo(cursor);

  this.userData.isSelecting = true;
}

function onSelectEnd() {
  this.userData.isSelecting = false;
}

function generateCylindricalUVs(geometry) {
  const positions = geometry.attributes.position.array;
  const uvs = [];

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    // Calculate cylindrical UVs
    const u = Math.atan2(z, x) / (2 * Math.PI) + 0.5;
    const v = y; // Normalize if needed based on your geometry height

    uvs.push(u, v);
  }

  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
}
