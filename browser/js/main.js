// Face Detect - 面部视差主程序
(function() {
	'use strict';

	// 配置
	const CONFIG = {
		imagePath: 'images/',
		parallaxStrength: 1.0,
		responseSpeed: 10,
		maxRotation: 15, // 最大旋转角度
		smoothingFactor: 0.15 // 平滑因子
	};

	// 状态
	const state = {
		cameraActive: false,
		faceDetected: false,
		currentRotation: { x: 0, y: 0, z: 0 },
		targetRotation: { x: 0, y: 0, z: 0 },
		animationFrame: null,
		faceMesh: null,
		camera: null
	};

	// DOM 元素
	const elements = {
		video: document.getElementById('video'),
		faceCanvas: document.getElementById('faceCanvas'),
		parallaxContainer: document.getElementById('parallaxContainer'),
		characterImage: document.getElementById('characterImage'),
		logoImage: document.getElementById('logoImage'),
		status: document.getElementById('status'),
		toggleCameraBtn: document.getElementById('toggleCamera'),
		parallaxStrength: document.getElementById('parallaxStrength'),
		strengthValue: document.getElementById('strengthValue'),
		responseSpeed: document.getElementById('responseSpeed'),
		speedValue: document.getElementById('speedValue'),
		characterGrid: document.getElementById('characterGrid'),
		debugInfo: document.getElementById('debugInfo'),
		headX: document.getElementById('headX'),
		headY: document.getElementById('headY'),
		headZ: document.getElementById('headZ')
	};

	// 角色映射
	const characters = {
		'firefly': 'firefly.png',
		'kafka': 'kafka.png',
		'aventurine': 'aventurine.png',
		'castorice': 'castorice.png',
		'cyrene': 'cyrene.png',
		'phainon': 'phainon.png',
		'ruan mei': 'ruan mei.png'
	};

	// 初始化
	async function init() {
		setupEventListeners();
		await initFaceMesh();
		updateStatus('ready', '就绪');
	}

	// 初始化 Face Mesh
	async function initFaceMesh() {
		try {
			elements.faceCanvas.width = 320;
			elements.faceCanvas.height = 240;
			
			state.faceMesh = new FaceMesh({
				locateFile: (file) => {
					return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
				}
			});

			state.faceMesh.setOptions({
				maxNumFaces: 1,
				refineLandmarks: true,
				minDetectionConfidence: 0.5,
				minTrackingConfidence: 0.5
			});

			state.faceMesh.onResults(onFaceMeshResults);
			
			updateStatus('ready', 'Face Mesh 已加载');
		} catch (error) {
			console.error('Face Mesh 初始化失败:', error);
			updateStatus('error', 'Face Mesh 加载失败');
		}
	}

	// Face Mesh 回调
	function onFaceMeshResults(results) {
		const ctx = elements.faceCanvas.getContext('2d');
		ctx.save();
		ctx.clearRect(0, 0, elements.faceCanvas.width, elements.faceCanvas.height);
		ctx.drawImage(results.image, 0, 0, elements.faceCanvas.width, elements.faceCanvas.height);

		if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
			const landmarks = results.multiFaceLandmarks[0];
			state.faceDetected = true;

			// 绘制面部关键点（调试用）
			drawFaceLandmarks(ctx, landmarks);

			// 计算头部姿态
			calculateHeadPose(landmarks);
		} else {
			state.faceDetected = false;
			// 无面部时逐渐归零
			state.targetRotation = { x: 0, y: 0, z: 0 };
		}
		ctx.restore();
	}

	// 绘制面部关键点
	function drawFaceLandmarks(ctx, landmarks) {
		ctx.fillStyle = 'rgba(255, 107, 157, 0.8)';
		
		// 绘制关键点
		const keyIndices = [1, 4, 5, 6, 9, 10, 11, 168, 397, 454]; // 鼻子、眼睛、嘴巴等
		for (const idx of keyIndices) {
			const point = landmarks[idx];
			const x = point.x * elements.faceCanvas.width;
			const y = point.y * elements.faceCanvas.height;
			
			ctx.beginPath();
			ctx.arc(x, y, 3, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	// 计算头部姿态
	function calculateHeadPose(landmarks) {
		// 关键点索引
		const nose = landmarks[1];
		const leftEye = landmarks[33];
		const rightEye = landmarks[263];
		const forehead = landmarks[10];
		const chin = landmarks[152];

		// 计算旋转
		const eyeCenter = {
			x: (leftEye.x + rightEye.x) / 2,
			y: (leftEye.y + rightEye.y) / 2
		};

		// 偏航 (Yaw) - 左右转动
		const yaw = (nose.x - eyeCenter.x) * CONFIG.maxRotation * 2;
		
		// 俯仰 (Pitch) - 上下转动
		const pitch = (nose.y - eyeCenter.y) * CONFIG.maxRotation * 2;
		
		// 翻滚 (Roll) - 倾斜
		const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI);
		const normalizedRoll = (roll - 45) / 45 * CONFIG.maxRotation;

		state.targetRotation = {
			x: pitch * CONFIG.parallaxStrength,
			y: yaw * CONFIG.parallaxStrength,
			z: normalizedRoll * CONFIG.parallaxStrength
		};

		// 更新调试信息
		updateDebugInfo();
	}

	// 更新调试信息
	function updateDebugInfo() {
		if (elements.debugInfo.style.display !== 'none') {
			elements.headX.textContent = state.currentRotation.x.toFixed(2);
			elements.headY.textContent = state.currentRotation.y.toFixed(2);
			elements.headZ.textContent = state.currentRotation.z.toFixed(2);
		}
	}

	// 视差动画循环
	function animateParallax() {
		// 平滑插值
		const speed = CONFIG.responseSpeed / 100;
		state.currentRotation.x += (state.targetRotation.x - state.currentRotation.x) * speed;
		state.currentRotation.y += (state.targetRotation.y - state.currentRotation.y) * speed;
		state.currentRotation.z += (state.targetRotation.z - state.currentRotation.z) * speed;

		// 获取所有视差层
		const layers = document.querySelectorAll('.parallax-layer');
		
		layers.forEach(layer => {
			const speedFactor = parseFloat(layer.dataset.speed) || 0.5;
			const rotateX = state.currentRotation.x * speedFactor;
			const rotateY = state.currentRotation.y * speedFactor;
			const rotateZ = state.currentRotation.z * speedFactor;
			
			layer.style.transform = `
				perspective(1000px)
				rotateX(${rotateX}deg)
				rotateY(${rotateY}deg)
				rotateZ(${rotateZ}deg)
			`;
		});

		state.animationFrame = requestAnimationFrame(animateParallax);
	}

	// 切换摄像头
	async function toggleCamera() {
		if (state.cameraActive) {
			stopCamera();
		} else {
			await startCamera();
		}
	}

	// 启动摄像头
	async function startCamera() {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: {
					width: { ideal: 640 },
					height: { ideal: 480 },
					facingMode: 'user'
				}
			});

			elements.video.srcObject = stream;
			await elements.video.play();

			// 启动 Camera Utils
			state.camera = new Camera(elements.video, {
				onFrame: async () => {
					if (state.faceMesh) {
						await state.faceMesh.send({ image: elements.video });
					}
				},
				width: 640,
				height: 480
			});

			state.camera.start();
			state.cameraActive = true;

			elements.toggleCameraBtn.classList.add('active');
			elements.toggleCameraBtn.querySelector('.btn-text').textContent = '关闭摄像头';
			updateStatus('active', '追踪中');

			// 启动动画循环
			if (!state.animationFrame) {
				animateParallax();
			}

		} catch (error) {
			console.error('摄像头启动失败:', error);
			updateStatus('error', '摄像头访问失败');
		}
	}

	// 停止摄像头
	function stopCamera() {
		if (state.camera) {
			state.camera.stop();
			state.camera = null;
		}

		if (elements.video.srcObject) {
			elements.video.srcObject.getTracks().forEach(track => track.stop());
			elements.video.srcObject = null;
		}

		state.cameraActive = false;
		elements.toggleCameraBtn.classList.remove('active');
		elements.toggleCameraBtn.querySelector('.btn-text').textContent = '开启摄像头';
		updateStatus('ready', '就绪');
	}

	// 更新状态显示
	function updateStatus(type, text) {
		elements.status.className = 'status ' + type;
		elements.status.textContent = text;
	}

	// 设置事件监听
	function setupEventListeners() {
		// 摄像头切换
		elements.toggleCameraBtn.addEventListener('click', toggleCamera);

		// 视差强度
		elements.parallaxStrength.addEventListener('input', (e) => {
			CONFIG.parallaxStrength = parseFloat(e.target.value);
			elements.strengthValue.textContent = CONFIG.parallaxStrength.toFixed(1);
		});

		// 响应速度
		elements.responseSpeed.addEventListener('input', (e) => {
			CONFIG.responseSpeed = parseInt(e.target.value);
			elements.speedValue.textContent = CONFIG.responseSpeed;
		});

		// 角色选择
		elements.characterGrid.addEventListener('click', (e) => {
			const btn = e.target.closest('.char-btn');
			if (!btn) return;

			// 移除其他active
			document.querySelectorAll('.char-btn').forEach(b => b.classList.remove('active'));
			btn.classList.add('active');

			const charName = btn.dataset.char;
			const imageFile = characters[charName];
			
			if (imageFile) {
				const newSrc = CONFIG.imagePath + imageFile;
				elements.characterImage.src = newSrc;
				elements.logoImage.src = newSrc;
			}
		});

		// 键盘快捷键
		document.addEventListener('keydown', (e) => {
			if (e.key === 'd' || e.key === 'D') {
				elements.debugInfo.style.display = 
					elements.debugInfo.style.display === 'none' ? 'block' : 'none';
			}
		});
	}

	// 启动
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();