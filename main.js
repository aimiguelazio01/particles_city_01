import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class PFMLoader extends THREE.FileLoader {
    constructor(manager) {
        super(manager);
        this.setResponseType('arraybuffer');
    }

    parse(buffer) {
        const view = new DataView(buffer);
        let offset = 0;

        function readLine() {
            let str = '';
            while (offset < buffer.byteLength) {
                const char = String.fromCharCode(view.getUint8(offset++));
                if (char === '\n') break;
                str += char;
            }
            return str.trim();
        }

        const type = readLine();
        const dims = readLine().split(/\s+/);
        const width = parseInt(dims[0]);
        const height = parseInt(dims[1]);
        const scale = parseFloat(readLine());
        const littleEndian = scale < 0;

        const numComponents = (type === 'PF') ? 3 : 1;
        const totalPixels = width * height;
        const dataRGBA = new Float32Array(totalPixels * 4);

        for (let i = 0; i < totalPixels; i++) {
            const i4 = i * 4;
            if (numComponents === 3) {
                dataRGBA[i4 + 0] = view.getFloat32(offset, littleEndian); offset += 4;
                dataRGBA[i4 + 1] = view.getFloat32(offset, littleEndian); offset += 4;
                dataRGBA[i4 + 2] = view.getFloat32(offset, littleEndian); offset += 4;
                dataRGBA[i4 + 3] = 1.0;
            } else {
                const val = view.getFloat32(offset, littleEndian); offset += 4;
                dataRGBA[i4 + 0] = val;
                dataRGBA[i4 + 1] = val;
                dataRGBA[i4 + 2] = val;
                dataRGBA[i4 + 3] = 1.0;
            }
        }

        const texture = new THREE.DataTexture(dataRGBA, width, height, THREE.RGBAFormat, THREE.FloatType);
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.needsUpdate = true;

        return texture;
    }

    load(url, onLoad, onProgress, onError) {
        return super.load(url, (buffer) => {
            try {
                onLoad(this.parse(buffer));
            } catch (e) {
                if (onError) onError(e);
            }
        }, onProgress, onError);
    }
}

class Experience {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.loaderStatus = document.getElementById('loader-status');
        this.progressFill = document.getElementById('progress-fill');
        this.debugLog = document.getElementById('debug-log');
        this.particleCountEl = document.getElementById('particle-count');
        this.loaderElement = document.getElementById('loader');

        this.chunks = [];
        this.manager = new THREE.LoadingManager();
        this.monochrome = true;
        this.mouse = new THREE.Vector3(0, 0, 0);
        this.raycaster = new THREE.Raycaster();
        this.mouse2D = new THREE.Vector2(-1, -1);
        this.clock = new THREE.Clock();
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        this.infographicsData = {
            lisbon: [
                {
                    title: "Belém Tower",
                    desc: "Iconic 16th-century fortification on the north bank of the Tagus River.",
                    image: "/assets/lisbon/belem.png",
                    pos: new THREE.Vector3(50, 10, -50)
                },
                {
                    title: "Jerónimos Monastery",
                    desc: "A masterpiece of Manueline architecture, designated a UNESCO World Heritage site.",
                    image: "/assets/lisbon/monastery.png",
                    pos: new THREE.Vector3(-100, 15, 120)
                },
                {
                    title: "Alfama District",
                    desc: "Lisbon's oldest neighborhood, famous for its narrow streets and Fado music.",
                    image: "/assets/lisbon/tram.png",
                    pos: new THREE.Vector3(120, 12, 180)
                }
            ],
            london: [
                {
                    title: "Tower Bridge",
                    desc: "A combined bascule and suspension bridge in London, built between 1886 and 1894.",
                    image: "/assets/london/bridge.png",
                    pos: new THREE.Vector3(25, 10, -35)
                },
                {
                    title: "The Shard",
                    desc: "A 72-story skyscraper, designed by the Italian architect Renzo Piano.",
                    image: "/assets/london/shard.png",
                    pos: new THREE.Vector3(-35, 35, -5)
                },
                {
                    title: "Big Ben",
                    desc: "The iconic clock tower at the north end of the Palace of Westminster, known for its Great Bell.",
                    image: "/assets/london/bigben.png",
                    pos: new THREE.Vector3(-15, 20, 45)
                }
            ]
        };

        this.currentCity = 'lisbon';
        this.infographics = [];

        this.init();
        this.setupUI();
        this.setupEvents();
    }

    async init() {
        this.log('Initializing Reconstruction...');

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100000);
        this.camera.position.set(0, 50, 200);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 1);
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;

        this.reconstructionGroup = new THREE.Group();
        this.scene.add(this.reconstructionGroup);

        // Add Sun Light
        this.sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
        this.sunLight.position.set(100, 200, 100);
        this.scene.add(this.sunLight);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

        try {
            await this.switchCity('lisbon');
            this.hideLoader();
        } catch (err) {
            this.log(`Error: ${err.message}`);
        }

        this.animate();
        this.setupInfographics();
        window.addEventListener('resize', () => this.onResize());
    }

    async loadChunks(manifest, folder) {
        const pfmLoader = new PFMLoader(this.manager);
        let totalPoints = 0;
        const globalMin = new THREE.Vector3(Infinity, Infinity, Infinity);
        const globalMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

        // First pass: Find global extent of chunk centers
        const centersMin = new THREE.Vector3(Infinity, Infinity, Infinity);
        const centersMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        manifest.forEach(e => {
            const c = e.bounds.center;
            centersMin.x = Math.min(centersMin.x, c[0]);
            centersMin.y = Math.min(centersMin.y, c[1]);
            centersMin.z = Math.min(centersMin.z, c[2]);
            centersMax.x = Math.max(centersMax.x, c[0]);
            centersMax.y = Math.max(centersMax.y, c[1]);
            centersMax.z = Math.max(centersMax.z, c[2]);
        });

        const fullCenter = new THREE.Vector3().addVectors(centersMin, centersMax).multiplyScalar(0.5);
        const fullSize = new THREE.Vector3().subVectors(centersMax, centersMin);

        // Crop factors to adjust loading speed and point density per city
        // We use a tighter crop for London (0.6) as requested to improve load times
        const cropFactor = (folder.includes('london')) ? 0.6 : 0.7;

        let loadedChunksCount = 0;
        for (const entry of manifest) {
            const { texture_pos, texture_col, count, texture_size, bounds, id } = entry;

            // Spatial Filter: Include chunks if their bounding sphere touches the region
            const c = bounds.center;
            const r = bounds.radius;
            // We use a slightly more inclusive check to ensure the region is "filled" 
            const insideX = Math.abs(c[0] - fullCenter.x) < (fullSize.x * 0.5 * cropFactor + r);
            const insideZ = Math.abs(c[2] - fullCenter.z) < (fullSize.z * 0.5 * cropFactor + r);

            if (!insideX || !insideZ) continue;

            loadedChunksCount++;
            totalPoints += count;
            const center = new THREE.Vector3(...bounds.center);
            globalMin.min(new THREE.Vector3(center.x - r, center.y - r, center.z - r));
            globalMax.max(new THREE.Vector3(center.x + r, center.y + r, center.z + r));

            this.setStatus(`Loading ${id}`);
            try {
                const [posTex, colTex] = await Promise.all([
                    this.loadPFM(pfmLoader, `/${folder}/${texture_pos}`),
                    this.loadPFM(pfmLoader, `/${folder}/${texture_col}`)
                ]);
                this.createChunk(posTex, colTex, count, texture_size, bounds);
            } catch (err) { console.warn(err); }
        }

        console.log(`Loaded ${loadedChunksCount} chunks out of ${manifest.length} for ${folder}`);
        const globalCenter = new THREE.Vector3().addVectors(globalMin, globalMax).multiplyScalar(0.5);
        this.reconstructionGroup.position.set(-globalCenter.x, -globalCenter.y, -globalCenter.z);
        this.particleCountEl.innerText = `${totalPoints.toLocaleString()} Points`;
    }

    async switchCity(cityName) {
        this.log(`Switching to ${cityName}...`);

        // Clear existing chunks
        this.chunks.forEach(c => {
            this.reconstructionGroup.remove(c);
            c.geometry.dispose();
            c.material.dispose();
        });
        this.chunks = [];

        const folder = cityName === 'london' ? 'scatter_chunks_london' : 'scatter_chunks_lisbon';
        const response = await fetch(`/${folder}/scatter_manifest.json`);
        const manifest = await response.json();

        await this.loadChunks(manifest, folder);

        // Adjust orientation per city
        if (cityName === 'london') {
            this.reconstructionGroup.rotation.x = Math.PI;
            this.reconstructionGroup.rotation.y = Math.PI;
            this.reconstructionGroup.rotation.z = 0;
        } else {
            this.reconstructionGroup.rotation.x = 0;
            this.reconstructionGroup.rotation.y = 0;
            this.reconstructionGroup.rotation.z = 0;
        }

        this.currentCity = cityName;
        const titleEl = document.getElementById('city-title');
        if (titleEl) titleEl.innerText = cityName.toUpperCase();

        this.setupInfographics();
        this.log(`${cityName.toUpperCase()} ACTIVE`);
    }

    loadPFM(loader, url) {
        return new Promise((resolve, reject) => loader.load(url, resolve, null, reject));
    }

    createChunk(posTex, colTex, count, size, bounds) {
        const geometry = new THREE.BufferGeometry();
        const refs = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
            refs[i * 2] = (i % size) / size;
            refs[i * 2 + 1] = Math.floor(i / size) / size;
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        geometry.setAttribute('reference', new THREE.BufferAttribute(refs, 2));

        // Optimize Frustum Culling: Provide accurate bounding sphere with padding for shader displacements
        const radiusPadding = 15.0; // Account for mouse interaction burst and noise
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(...bounds.center), bounds.radius + radiusPadding);
        geometry.computeBoundingBox(); // Secondary fallback for some renderers

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uPosTex: { value: posTex },
                uColTex: { value: colTex },
                uSize: { value: 0.2 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
                uMonochrome: { value: this.monochrome ? 1.0 : 0.0 },
                uTime: { value: 0 },
                uMouse: { value: this.mouse },
                uSunDir: { value: new THREE.Vector3(1, 2, 1).normalize() }
            },
            vertexShader: `
                uniform sampler2D uPosTex;
                uniform sampler2D uColTex;
                uniform float uSize;
                uniform float uPixelRatio;
                uniform float uMonochrome;
                uniform float uTime;
                uniform vec3 uMouse;
                attribute vec2 reference;
                varying vec3 vOrigColor;
                varying float vMouseInfluence;
                varying float vSunLight;
                uniform vec3 uSunDir;

                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
                float snoise(vec3 v) {
                    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
                    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
                    vec3 i = floor(v + dot(v, C.yyy));
                    vec3 x0 = v - i + dot(i, C.xxx);
                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min(g.xyz, l.zxy);
                    vec3 i2 = max(g.xyz, l.zxy);
                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;
                    i = mod289(i);
                    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
                    float n_ = 0.142857142857;
                    vec3 ns = n_ * D.wyz - D.xzx;
                    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
                    vec4 x_ = floor(j * ns.z);
                    vec4 y_ = floor(j - 7.0 * x_);
                    vec4 x = x_ * ns.x + ns.yyyy;
                    vec4 y = y_ * ns.x + ns.yyyy;
                    vec4 h = 1.0 - abs(x) - abs(y);
                    vec4 b0 = vec4(x.xy, y.xy);
                    vec4 b1 = vec4(x.zw, y.zw);
                    vec4 s0 = floor(b0) * 2.0 + 1.0;
                    vec4 s1 = floor(b1) * 2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));
                    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
                    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
                    vec3 p0 = vec3(a0.xy, h.x);
                    vec3 p1 = vec3(a0.zw, h.y);
                    vec3 p2 = vec3(a1.xy, h.z);
                    vec3 p3 = vec3(a1.zw, h.w);
                    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
                    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
                    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
                    m = m * m;
                    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
                }

                void main() {
                    vec3 pos = texture2D(uPosTex, reference).xyz;
                    vOrigColor = texture2D(uColTex, reference).xyz;

                    float dist = distance(pos, uMouse);
                    float radiusNoise = snoise(pos * 0.05 + uTime * 0.3) * 4.0;
                    float baseRadius = ${this.isMobile ? '20.0' : '12.0'};
                    float radius = baseRadius + radiusNoise;
                    
                    float influence = 1.0 - smoothstep(0.0, radius, dist);
                    vMouseInfluence = influence;

                    if(influence > 0.0) {
                        vec3 dir = normalize(pos - uMouse);
                        float burst = sin(uTime * 3.0 + dist * 0.2) * 0.5;
                        pos += dir * (influence * 3.0 + burst * influence);
                        pos += snoise(pos * 0.1 + uTime * 0.4) * (influence * 1.5);
                    }

                    // Simple directional lighting based on 'up' vector for points
                    vSunLight = max(0.2, dot(vec3(0.0, 1.0, 0.0), uSunDir)); 
                    // Even better: use the particle's relative position or a fake normal
                    // For now, let's just create a top-down light influence
                    vSunLight = 0.8 + 0.4 * dot(vec3(0.0, 1.0, 0.0), uSunDir);
                    
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPos;
                    gl_PointSize = (uSize * (uMonochrome > 0.5 ? 1.0 : 0.5)) * uPixelRatio * (2000.0 / -mvPos.z);
                    gl_PointSize = max(gl_PointSize, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vOrigColor;
                varying float vMouseInfluence;
                varying float vSunLight;
                uniform float uMonochrome;
                void main() {
                    float dist = distance(gl_PointCoord, vec2(0.5));
                    if (dist > 0.5) discard;
                    float mask = pow(1.0 - (dist * 2.0), 2.0);
                    vec3 baseColor = (uMonochrome > 0.5) ? vec3(0.5) : (vOrigColor * 1.5) / (1.0 + vOrigColor * 1.0);
                    vec3 color = baseColor * vSunLight;
                    
                    // Subtle visual fade on interaction
                    color += vMouseInfluence * 0.15;
                    
                    float alpha = (uMonochrome > 0.5) ? 0.5 : 0.7;
                    gl_FragColor = vec4(color, mask * (alpha + vMouseInfluence * 0.2));
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(geometry, material);
        points.frustumCulled = true;

        // Performance: Disable auto-update since chunks are static within the reconstructionGroup
        points.matrixAutoUpdate = false;
        points.updateMatrix();

        this.reconstructionGroup.add(points);
        this.chunks.push(points);
    }

    setupEvents() {
        const onPointerMove = (e) => {
            this.mouse2D.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse2D.y = -(e.clientY / window.innerHeight) * 2 + 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerdown', onPointerMove);

        this.rayPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    }

    updateMousePosition() {
        this.raycaster.setFromCamera(this.mouse2D, this.camera);

        // Update plane to face the camera at the origin of the world
        // This makes mouse tracking work from any angle
        const normal = new THREE.Vector3();
        this.camera.getWorldDirection(normal).negate();
        this.rayPlane.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, 0, 0));

        const target = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.rayPlane, target)) {
            this.reconstructionGroup.worldToLocal(target);
            this.mouse.lerp(target, 0.1);
        }
    }

    setupUI() {
        const btn = document.getElementById('toggle-color');
        if (btn) btn.addEventListener('click', () => {
            this.monochrome = !this.monochrome;
            this.chunks.forEach(c => c.material.uniforms.uMonochrome.value = this.monochrome ? 1.0 : 0.0);
            btn.innerText = this.monochrome ? 'Set Multi-Color' : 'Set Monochrome';
        });

        const lBtn = document.getElementById('btn-lisbon');
        if (lBtn) lBtn.addEventListener('click', () => {
            if (this.currentCity !== 'lisbon') this.switchCity('lisbon');
        });

        const lonBtn = document.getElementById('btn-london');
        if (lonBtn) lonBtn.addEventListener('click', () => {
            if (this.currentCity !== 'london') this.switchCity('london');
        });
    }

    setupInfographics() {
        const container = document.getElementById('infographic-container');
        if (!container) return;

        // Clear existing
        this.infographics.forEach(info => {
            if (info.element) info.element.remove();
        });
        this.infographics = [];

        const data = this.infographicsData[this.currentCity];
        if (!data) return;

        data.forEach((info, index) => {
            const card = document.createElement('div');
            card.className = 'info-card';
            card.innerHTML = `
                <img src="${info.image}" alt="${info.title}">
                <h3>${info.title}</h3>
                <p>${info.desc}</p>
                <div class="marker-line"></div>
                <div class="marker-dot"></div>
            `;
            container.appendChild(card);

            const newInfo = { ...info, element: card };
            this.infographics.push(newInfo);

            // Show cards after a delay
            setTimeout(() => card.classList.add('visible'), 500 + index * 300);
        });
    }

    updateInfographics() {
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        const tempVec = new THREE.Vector3();

        this.infographics.forEach(info => {
            if (!info.element) return;

            // Get world position of the point
            tempVec.copy(info.pos);
            // Account for reconstruction group transform
            tempVec.applyMatrix4(this.reconstructionGroup.matrixWorld);

            // Project to screen
            tempVec.project(this.camera);

            // Check if point is in front of camera
            if (tempVec.z > 1) {
                info.element.style.display = 'none';
            } else {
                info.element.style.display = 'block';
                const x = (tempVec.x * widthHalf) + widthHalf;
                const y = -(tempVec.y * heightHalf) + heightHalf;
                info.element.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
            }
        });
    }

    log(msg) {
        console.log(msg);
        if (this.debugLog) this.debugLog.innerText = msg.toUpperCase();
    }
    setStatus(s) { if (this.loaderStatus) this.loaderStatus.innerText = s; }
    hideLoader() { if (this.loaderElement) setTimeout(() => this.loaderElement.classList.add('hidden'), 1000); }
    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    animate() {
        requestAnimationFrame(() => this.animate());
        this.updateMousePosition();
        const time = this.clock.getElapsedTime();
        this.chunks.forEach(c => {
            c.material.uniforms.uTime.value = time;
            c.material.uniforms.uMouse.value.copy(this.mouse);
        });
        this.updateInfographics();
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

window.addEventListener('load', () => new Experience());
