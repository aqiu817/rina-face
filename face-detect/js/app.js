const IMAGE_OPTIONS = [
	"aventurine.png",
	"castorice.png",
	"cyrene.png",
	"firefly.png",
	"kafka.png",
	"phainon.png",
	"ruan mei.png"
];
const IMAGE_PATH = "images/";

const PRESETS = {
const IMAGE_PATH = "/browser/images/";

const PRESETS = {
	default: {
		maskX: 0.5,
		maskY: 0.57,
		maskW: 0.34,
		maskH: 0.44,
		feather: 0.11,
		logoX: 0.67,
		logoY: 0.02,
		logoW: 0.28,
		logoH: 0.16
	}
};

const stage = document.getElementById("stage");
const ctx = stage.getContext("2d");
const statusEl = document.getElementById("status");
const imageSelect = document.getElementById("imageSelect");
const cameraButton = document.getElementById("cameraButton");
const resetButton = document.getElementById("resetButton");
const camera = document.getElementById("camera");

const controlIds = [
	"response",
	"xStrength",
	"yStrength",
	"tiltStrength",
	"maskX",
	"maskY",
	"maskW",
	"maskH",
	"feather",
	"logoX",
	"logoY",
	"logoW",
	"logoH"
];

const controls = Object.fromEntries(
	controlIds.map(function(id) { return [id, document.getElementById(id)]; })
);

const outputs = Object.fromEntries(
	controlIds.map(function(id) { return [id, document.getElementById(id + "Value")]; })
);

const offscreen = {
	subject: document.createElement("canvas"),
	background: document.createElement("canvas"),
	logo: document.createElement("canvas"),
	mask: document.createElement("canvas")
};

for (var key in offscreen) {
	offscreen[key].width = stage.width;
	offscreen[key].height = stage.height;
}

const motion = {
	rawX: 0,
	rawY: 0,
	rawTilt: 0,
	x: 0,
	y: 0,
	tilt: 0
};

const state = {
	imageName: IMAGE_OPTIONS[0],
	image: null,
	cameraOn: false,
	faceLandmarker: null,
	lastVideoTime: -1,
	trackingReady: false
};

function setStatus(text) {
	statusEl.textContent = text;
	console.log("Status:", text);
}

function updateOutput(id) {
	var decimals = (id === "xStrength" || id === "yStrength") ? 0 : (id === "tiltStrength" ? 1 : 2);
	outputs[id].textContent = Number(controls[id].value).toFixed(decimals);
}

function updateAllOutputs() {
	controlIds.forEach(updateOutput);
}

function populateSelect() {
	imageSelect.innerHTML = IMAGE_OPTIONS.map(function(name) {
		return "<option value=\"" + name + "\">" + name.replace(".png", "") + "</option>";
	}).join("");
}

function loadPreset(name) {
	var preset = PRESETS[name] || PRESETS.default;
	for (var key in preset) {
		controls[key].value = preset[key];
	}
	updateAllOutputs();
}

function loadImage(name) {
	return new Promise(function(resolve, reject) {
		var image = new Image();
		image.onload = function() {
			console.log("图片加载成功:", name);
			state.image = image;
			state.imageName = name;
			loadPreset(name);
			setStatus("已加载 " + name + "，可直接预览或开启摄像头");
			resolve();
		};
		image.onerror = function(e) {
			console.error("图片加载失败:", name, e);
			setStatus("图片加载失败: " + name);
			reject(e);
		};
		image.src = IMAGE_PATH + encodeURIComponent(name);
		console.log("尝试加载图片:", IMAGE_PATH + encodeURIComponent(name));
	});
}

function drawMask() {
	var canvas = offscreen.mask;
	var maskCtx = canvas.getContext("2d");
	var width = canvas.width;
	var height = canvas.height;
	var cx = Number(controls.maskX.value) * width;
	var cy = Number(controls.maskY.value) * height;
	var rx = Number(controls.maskW.value) * width;
	var ry = Number(controls.maskH.value) * height;
	var feather = Number(controls.feather.value);

	maskCtx.clearRect(0, 0, width, height);

	var gradient = maskCtx.createRadialGradient(cx, cy, Math.max(rx, ry) * (1 - feather), cx, cy, Math.max(rx, ry));
	gradient.addColorStop(0, "rgba(255,255,255,1)");
	gradient.addColorStop(1, "rgba(255,255,255,0)");

	maskCtx.save();
	maskCtx.translate(cx, cy);
	maskCtx.scale(1, ry / rx);
	maskCtx.fillStyle = gradient;
	maskCtx.beginPath();
	maskCtx.arc(0, 0, rx, 0, Math.PI * 2);
	maskCtx.fill();
	maskCtx.restore();
}

function buildLayers() {
	if (!state.image) {
		console.log("没有图片，跳过构建图层");
		return;
	}

	var width = stage.width;
	var height = stage.height;
	var backgroundCtx = offscreen.background.getContext("2d");
	var subjectCtx = offscreen.subject.getContext("2d");
	var logoCtx = offscreen.logo.getContext("2d");
	var maskCanvas = offscreen.mask;

	drawMask();

	backgroundCtx.clearRect(0, 0, width, height);
	backgroundCtx.filter = "blur(24px) saturate(1.05) brightness(0.96)";
	backgroundCtx.drawImage(state.image, -26, -20, width + 52, height + 44);
	backgroundCtx.filter = "none";
	backgroundCtx.globalCompositeOperation = "destination-out";
	backgroundCtx.drawImage(maskCanvas, 0, 0);
	backgroundCtx.globalCompositeOperation = "source-over";

	subjectCtx.clearRect(0, 0, width, height);
	subjectCtx.drawImage(state.image, 0, 0, width, height);
	subjectCtx.globalCompositeOperation = "destination-in";
	subjectCtx.drawImage(maskCanvas, 0, 0);
	subjectCtx.globalCompositeOperation = "source-over";

	logoCtx.clearRect(0, 0, width, height);
	var logoX = Number(controls.logoX.value) * width;
	var logoY = Number(controls.logoY.value) * height;
	var logoW = Number(controls.logoW.value) * width;
	var logoH = Number(controls.logoH.value) * height;
	logoCtx.drawImage(state.image, logoX, logoY, logoW, logoH, logoX, logoY, logoW, logoH);
}

function render() {
	if (!state.image) {
		requestAnimationFrame(render);
		return;
	}

	var smoothing = Number(controls.response.value);
	motion.x += (motion.rawX - motion.x) * smoothing;
	motion.y += (motion.rawY - motion.y) * smoothing;
	motion.tilt += (motion.rawTilt - motion.tilt) * smoothing;

	var xStrength = Number(controls.xStrength.value);
	var yStrength = Number(controls.yStrength.value);
	var tiltStrength = Number(controls.tiltStrength.value);

	ctx.clearRect(0, 0, stage.width, stage.height);
	ctx.fillStyle = "#f3ebe1";
	ctx.fillRect(0, 0, stage.width, stage.height);

	ctx.save();
	ctx.translate(stage.width / 2, stage.height / 2);
	ctx.rotate((-motion.tilt * tiltStrength * 0.18 * Math.PI) / 180);
	ctx.translate(-stage.width / 2, -stage.height / 2);
	ctx.drawImage(offscreen.background, motion.x * xStrength * 0.35 - 24, motion.y * yStrength * 0.3 - 16, stage.width + 48, stage.height + 32);
	ctx.restore();

	ctx.save();
	ctx.translate(stage.width / 2, stage.height / 2);
	ctx.rotate((-motion.tilt * tiltStrength * 0.45 * Math.PI) / 180);
	ctx.translate(-stage.width / 2, -stage.height / 2);
	ctx.shadowColor = "rgba(35, 17, 20, 0.26)";
	ctx.shadowBlur = 48;
	ctx.shadowOffsetY = 20;
	ctx.drawImage(offscreen.subject, motion.x * xStrength * 0.9, motion.y * yStrength * 0.75, stage.width, stage.height);
	ctx.restore();

	ctx.save();
	ctx.translate(stage.width / 2, stage.height / 2);
	ctx.rotate((-motion.tilt * tiltStrength * 0.9 * Math.PI) / 180);
	ctx.translate(-stage.width / 2, -stage.height / 2);
	ctx.drawImage(offscreen.logo, motion.x * xStrength * 1.18, motion.y * yStrength * 0.96, stage.width, stage.height);
	ctx.restore();

	requestAnimationFrame(render);
}

function bindEvents() {
	imageSelect.addEventListener("change", function(event) {
		loadImage(event.target.value).then(function() {
			buildLayers();
		});
	});

	controlIds.forEach(function(id) {
		controls[id].addEventListener("input", function() {
			updateOutput(id);
			buildLayers();
		});
	});

	cameraButton.addEventListener("click", function() {
		setStatus("人脸识别功能开发中...");
	});

	resetButton.addEventListener("click", function() {
		loadPreset(state.imageName);
		buildLayers();
	});
}

function init() {
	console.log("初始化开始...");
	populateSelect();
	imageSelect.value = state.imageName;
	updateAllOutputs();
	bindEvents();
	
	loadImage(state.imageName).then(function() {
		buildLayers();
		render();
	}).catch(function(err) {
		console.error("初始化失败:", err);
	});
}

window.addEventListener("DOMContentLoaded", function() {
	init();
});