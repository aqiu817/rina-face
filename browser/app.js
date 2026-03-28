import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.179.1/build/three.module.js";
import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

const IMAGE_OPTIONS = [
  "aventurine.png",
  "castorice.png",
  "cyrene.png",
  "firefly.png",
  "kafka.png",
  "phainon.png",
  "ruan mei.png"
];

const manifestResponse = await fetch("./layers/manifest.json");
const LAYER_MANIFEST = await manifestResponse.json();

const PRESETS = {
  default: {
    response: 0.24,
    xStrength: 48,
    yStrength: 30,
    tiltStrength: 8,
    cameraOffsetX: 0,
    cameraOffsetY: 0,
    cameraOffsetZ: 0
  }
};

const stage = document.getElementById("stage");
const statusEl = document.getElementById("status");
const imageSelect = document.getElementById("imageSelect");
const cameraButton = document.getElementById("cameraButton");
const resetButton = document.getElementById("resetButton");
const recenterButton = document.getElementById("recenterButton");
const cameraFeed = document.getElementById("camera");
const showLogoControl = document.getElementById("showLogo");

const controlIds = [
  "response",
  "xStrength",
  "yStrength",
  "tiltStrength",
  "cameraOffsetX",
  "cameraOffsetY",
  "cameraOffsetZ"
];
const controls = Object.fromEntries(
  controlIds.map((id) => [id, document.getElementById(id)])
);
const outputs = Object.fromEntries(
  controlIds.map((id) => [id, document.getElementById(`${id}Value`)])
);

const state = {
  imageName: IMAGE_OPTIONS[0],
  layerPaths: null,
  currentGroup: null,
  cameraOn: false,
  faceLandmarker: null,
  lastVideoTime: -1,
  trackingReady: false
};

const headPose = {
  rawX: 0.5,
  rawY: 0.5,
  rawZ: 1.0,
  x: 0.5,
  y: 0.5,
  z: 1.0
};

const poseCenter = {
  x: 0.5,
  y: 0.5,
  z: 1.0
};

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f3ebe1");
scene.fog = new THREE.Fog("#f3ebe1", 2.4, 5.4);

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 20);
const renderer = new THREE.WebGLRenderer({
  canvas: stage,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance"
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const SCREEN_WIDTH_WORLD = 2;
const SCREEN_HEIGHT_WORLD = 2;
const BASE_DISTANCE = 2.2;
const textureLoader = new THREE.TextureLoader();

function setStatus(text) {
  statusEl.textContent = text;
}

function isCameraSecureContext() {
  if (window.isSecureContext) {
    return true;
  }

  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function formatCameraError(error) {
  if (!error) {
    return "摄像头或模型初始化失败";
  }

  if (error.name === "NotAllowedError") {
    return "摄像头权限被拒绝，或当前页面不是 HTTPS / localhost";
  }

  if (error.name === "NotFoundError") {
    return "未找到可用摄像头";
  }

  if (error.name === "NotReadableError") {
    return "摄像头被其他应用占用，无法读取";
  }

  if (error.name === "SecurityError") {
    return "当前页面不是安全上下文，HTTP 局域网地址无法调用摄像头";
  }

  return `摄像头或模型初始化失败: ${error.name || "UnknownError"}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateOutput(id) {
  outputs[id].textContent = Number(controls[id].value).toFixed(
    id === "xStrength" || id === "yStrength" ? 0 : 2
  );
}

function updateAllOutputs() {
  controlIds.forEach(updateOutput);
}

function populateSelect() {
  imageSelect.innerHTML = IMAGE_OPTIONS
    .map((name) => `<option value="${name}">${name.replace(".png", "")}</option>`)
    .join("");
}

function loadPreset(name) {
  const preset = PRESETS[name] || PRESETS.default;
  for (const [key, value] of Object.entries(preset)) {
    controls[key].value = value;
  }
  updateAllOutputs();
}

function resizeRenderer() {
  const width = stage.clientWidth || 1000;
  const height = stage.clientHeight || 1000;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
}

function updateOffAxisCamera() {
  const xStrength = Number(controls.xStrength.value) / 44;
  const yStrength = Number(controls.yStrength.value) / 30;
  const offsetX = Number(controls.cameraOffsetX.value);
  const offsetY = Number(controls.cameraOffsetY.value);
  const offsetZ = Number(controls.cameraOffsetZ.value);
  const centeredX = headPose.x - poseCenter.x + 0.5 + offsetX;
  const centeredY = headPose.y - poseCenter.y + 0.5 + offsetY;
  const centeredZ = headPose.z - poseCenter.z + 1 + offsetZ;

  const eyeX = (centeredX - 0.5) * SCREEN_WIDTH_WORLD * 1.5 * xStrength;
  const eyeY = (centeredY - 0.5) * SCREEN_HEIGHT_WORLD * 1.25 * yStrength;
  const eyeZ = BASE_DISTANCE / clamp(centeredZ, 0.7, 1.55);

  const near = camera.near;
  const far = camera.far;
  const screenLeft = -SCREEN_WIDTH_WORLD / 2;
  const screenRight = SCREEN_WIDTH_WORLD / 2;
  const screenBottom = -SCREEN_HEIGHT_WORLD / 2;
  const screenTop = SCREEN_HEIGHT_WORLD / 2;
  const viewerToScreenDistance = eyeZ;
  const scale = near / viewerToScreenDistance;

  const left = (screenLeft - eyeX) * scale;
  const right = (screenRight - eyeX) * scale;
  const bottom = (screenBottom - eyeY) * scale;
  const top = (screenTop - eyeY) * scale;

  camera.position.set(eyeX, eyeY, eyeZ);
  camera.lookAt(eyeX, eyeY, 0);
  camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

function makeLayerMesh(texture, depth, scale = 1, opacity = 1) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const geometry = new THREE.PlaneGeometry(SCREEN_WIDTH_WORLD * scale, SCREEN_HEIGHT_WORLD * scale);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = depth;
  return mesh;
}

function disposeGroup(group) {
  if (!group) {
    return;
  }

  group.traverse((child) => {
    if (!child.isMesh) {
      return;
    }
    child.geometry.dispose();
    if (child.material.map) {
      child.material.map.dispose();
    }
    child.material.dispose();
  });
  scene.remove(group);
}

async function loadTexture(src) {
  return textureLoader.loadAsync(src);
}

async function loadImage(name) {
  const paths = LAYER_MANIFEST[name];
  if (!paths) {
    throw new Error(`Missing layer manifest entry for ${name}`);
  }

  const [backgroundTexture, subjectTexture, logoTexture] = await Promise.all([
    loadTexture(paths.background),
    loadTexture(paths.subject),
    loadTexture(paths.logo)
  ]);

  disposeGroup(state.currentGroup);

  const group = new THREE.Group();
  group.add(makeLayerMesh(backgroundTexture, -0.72, 1.18, 1));
  group.add(makeLayerMesh(subjectTexture, -0.18, 1.04, 1));
  group.add(makeLayerMesh(logoTexture, -0.05, 1.02, 1));

  scene.add(group);
  state.currentGroup = group;
  state.layerPaths = paths;
  state.imageName = name;

  loadPreset(name);
  setStatus(`已加载 ${name}，当前为头耦合透视模式`);
}

function animate() {
  requestAnimationFrame(animate);

  resizeRenderer();

  const smoothing = Number(controls.response.value);
  headPose.x += (headPose.rawX - headPose.x) * smoothing;
  headPose.y += (headPose.rawY - headPose.y) * smoothing;
  headPose.z += (headPose.rawZ - headPose.z) * smoothing;

  if (state.currentGroup) {
    const followStrength = Number(controls.tiltStrength.value);
    const offsetX = Number(controls.cameraOffsetX.value);
    const offsetY = Number(controls.cameraOffsetY.value);
    const centeredX = headPose.x - poseCenter.x + 0.5 + offsetX;
    const centeredY = headPose.y - poseCenter.y + 0.5 + offsetY;
    const background = state.currentGroup.children[0];
    const subject = state.currentGroup.children[1];
    const logo = state.currentGroup.children[2];

    background.position.x = (centeredX - 0.5) * 0.05;
    background.position.y = (centeredY - 0.5) * 0.04;

    subject.position.x = (centeredX - 0.5) * (0.06 + followStrength * 0.004);
    subject.position.y = (centeredY - 0.5) * 0.035;

    logo.position.x = (centeredX - 0.5) * 0.018;
    logo.position.y = (centeredY - 0.5) * 0.012;
    logo.visible = showLogoControl.checked;
  }

  updateOffAxisCamera();
  renderer.render(scene, camera);
}

function estimatePose(landmarks) {
  const nose = landmarks[1];
  const leftEyeInner = landmarks[133];
  const rightEyeInner = landmarks[362];
  const leftEyeOuter = landmarks[33];
  const rightEyeOuter = landmarks[263];

  if (!nose || !leftEyeInner || !rightEyeInner || !leftEyeOuter || !rightEyeOuter) {
    return;
  }

  const faceX = (leftEyeInner.x + rightEyeInner.x + nose.x) / 3;
  const faceY = (leftEyeInner.y + rightEyeInner.y + nose.y) / 3;

  const interOcularDist = Math.hypot(
    rightEyeInner.x - leftEyeInner.x,
    rightEyeInner.y - leftEyeInner.y
  );
  const eyeWidth = Math.hypot(
    rightEyeOuter.x - leftEyeOuter.x,
    rightEyeOuter.y - leftEyeOuter.y
  );
  const depthProxy = (interOcularDist + eyeWidth * 0.5) / 0.15;

  headPose.rawX = clamp(faceX, 0.2, 0.8);
  headPose.rawY = clamp(faceY, 0.2, 0.8);
  headPose.rawZ = clamp(depthProxy, 0.75, 1.45);
}

async function ensureLandmarker() {
  if (state.faceLandmarker) {
    return state.faceLandmarker;
  }

  setStatus("正在加载人脸跟踪模型");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  const commonOptions = {
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  };

  try {
    state.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      ...commonOptions,
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU"
      }
    });
  } catch (gpuError) {
    state.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      ...commonOptions,
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "CPU"
      }
    });
    setStatus("GPU 模型初始化失败，已回退到 CPU");
  }

  return state.faceLandmarker;
}

function scheduleTracking() {
  if (typeof cameraFeed.requestVideoFrameCallback === "function") {
    cameraFeed.requestVideoFrameCallback(trackFace);
    return;
  }

  requestAnimationFrame(trackFace);
}

function trackFace() {
  if (!state.cameraOn || !state.faceLandmarker || cameraFeed.readyState < 2) {
    return;
  }

  const nowInMs = performance.now();
  const videoTime = cameraFeed.currentTime;
  if (videoTime !== state.lastVideoTime) {
    state.lastVideoTime = videoTime;
    const result = state.faceLandmarker.detectForVideo(cameraFeed, nowInMs);
    if (result.faceLandmarks.length > 0) {
      estimatePose(result.faceLandmarks[0]);
      if (!state.trackingReady) {
        state.trackingReady = true;
        setStatus("头部已锁定，视角会按左右位置和远近变化");
      }
    }
  }

  scheduleTracking();
}

async function toggleCamera() {
  if (state.cameraOn) {
    const stream = cameraFeed.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    cameraFeed.srcObject = null;
    state.cameraOn = false;
    state.trackingReady = false;
    state.lastVideoTime = -1;
    headPose.rawX = 0.5;
    headPose.rawY = 0.5;
    headPose.rawZ = 1;
    cameraButton.textContent = "开启摄像头";
    setStatus(`已关闭摄像头，当前素材 ${state.imageName}`);
    return;
  }

  try {
    if (!isCameraSecureContext()) {
      throw new DOMException(
        "Camera requires HTTPS or localhost secure context",
        "SecurityError"
      );
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new DOMException("getUserMedia is not available", "NotSupportedError");
    }

    await ensureLandmarker();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });
    cameraFeed.srcObject = stream;
    await cameraFeed.play();
    state.cameraOn = true;
    state.lastVideoTime = -1;
    cameraButton.textContent = "关闭摄像头";
    setStatus("摄像头已开启，等待锁定头部");
    scheduleTracking();
  } catch (error) {
    console.error(error);
    setStatus(formatCameraError(error));
  }
}

function bindEvents() {
  imageSelect.addEventListener("change", async (event) => {
    await loadImage(event.target.value);
  });

  for (const id of controlIds) {
    controls[id].addEventListener("input", () => updateOutput(id));
  }

  cameraButton.addEventListener("click", toggleCamera);

  resetButton.addEventListener("click", () => {
    loadPreset(state.imageName);
    showLogoControl.checked = false;
    poseCenter.x = 0.5;
    poseCenter.y = 0.5;
    poseCenter.z = 1;
    headPose.rawX = 0.5;
    headPose.rawY = 0.5;
    headPose.rawZ = 1;
    headPose.x = 0.5;
    headPose.y = 0.5;
    headPose.z = 1;
    setStatus(`已重置视角参数，当前素材 ${state.imageName}`);
  });

  recenterButton.addEventListener("click", () => {
    poseCenter.x = headPose.rawX;
    poseCenter.y = headPose.rawY;
    poseCenter.z = headPose.rawZ;
    setStatus("已将当前头部位置设为摄像头中心");
  });

  showLogoControl.addEventListener("change", () => {
    setStatus(showLogoControl.checked ? "已显示 Logo 图层" : "已隐藏 Logo 图层");
  });

  window.addEventListener("resize", resizeRenderer);
}

async function init() {
  populateSelect();
  imageSelect.value = state.imageName;
  showLogoControl.checked = false;
  loadPreset(state.imageName);
  bindEvents();
  resizeRenderer();
  await loadImage(state.imageName);
  animate();
}

init().catch((error) => {
  console.error(error);
  setStatus("初始化失败，请检查控制台");
});
