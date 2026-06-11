/* Cinematic stage: renderer, camera, lights, smoke/steam particles, camera shake. */

import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { RoomEnvironment } from "../vendor/RoomEnvironment.js";

function softSpriteTexture(inner = "rgba(255,255,255,1)", size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.55, "rgba(255,255,255,.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function groundTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(256, 256, 40, 256, 256, 256);
  grad.addColorStop(0, "#f4ecdc");
  grad.addColorStop(0.6, "#e9deca");
  grad.addColorStop(1, "#d8c9ad");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
    this.smokeTex = softSpriteTexture();
  }

  _get() {
    let s = this.pool.pop();
    if (!s) {
      const mat = new THREE.SpriteMaterial({
        map: this.smokeTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.5,
      });
      s = new THREE.Sprite(mat);
      this.scene.add(s);
    }
    s.visible = true;
    return s;
  }

  spawn(opts) {
    const s = this._get();
    s.position.copy(opts.pos);
    s.material.color.set(opts.color ?? 0xffffff);
    s.material.opacity = opts.opacity ?? 0.5;
    s.userData = {
      vel: opts.vel.clone(),
      life: 0,
      ttl: opts.ttl ?? 1.2,
      grow: opts.grow ?? 1.6,
      drag: opts.drag ?? 2.0,
      rise: opts.rise ?? 0,
      sway: opts.sway ?? 0,
      swayPhase: Math.random() * Math.PI * 2,
      baseOpacity: opts.opacity ?? 0.5,
      scale0: opts.scale ?? 0.25,
    };
    s.scale.setScalar(s.userData.scale0);
    this.active.push(s);
  }

  /* dusty impact puff radiating outwards from a landing point */
  puff(pos, { count = 9, color = 0xcdbfa8, speed = 1.0, scale = 0.22, opacity = 0.42 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const v = new THREE.Vector3(
        Math.cos(a) * speed * (0.6 + Math.random() * 0.6),
        0.4 + Math.random() * 0.5,
        Math.sin(a) * speed * (0.6 + Math.random() * 0.6)
      );
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.02, (Math.random() - 0.5) * 0.15)),
        vel: v,
        color,
        ttl: 1.0 + Math.random() * 0.6,
        grow: 2.2,
        drag: 3.0,
        scale: scale * (0.8 + Math.random() * 0.5),
        opacity,
      });
    }
  }

  /* hot sizzling steam, slowly curling upwards */
  steam(pos, { count = 6, color = 0xffffff } = {}) {
    for (let i = 0; i < count; i++) {
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.05, (Math.random() - 0.5) * 0.4)),
        vel: new THREE.Vector3(0, 0.25 + Math.random() * 0.3, 0),
        color,
        ttl: 1.6 + Math.random() * 1.2,
        grow: 1.3,
        drag: 0.4,
        rise: 0.35,
        sway: 0.25,
        scale: 0.14 + Math.random() * 0.1,
        opacity: 0.28,
      });
    }
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      const u = s.userData;
      u.life += dt;
      const t = u.life / u.ttl;
      if (t >= 1) {
        s.visible = false;
        this.active.splice(i, 1);
        this.pool.push(s);
        continue;
      }
      u.vel.multiplyScalar(Math.max(0, 1 - u.drag * dt));
      u.vel.y += u.rise * dt;
      s.position.addScaledVector(u.vel, dt);
      if (u.sway) s.position.x += Math.sin(u.life * 3 + u.swayPhase) * u.sway * dt;
      s.scale.setScalar(u.scale0 * (1 + t * u.grow));
      s.material.opacity = u.baseOpacity * (1 - t) * (1 - t);
    }
  }
}

export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xefe5d1);
    this.scene.fog = new THREE.Fog(0xefe5d1, 9, 20);

    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 60);
    this.camera.position.set(0, 3.4, 6.2);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    // warm key light with soft shadows
    const key = new THREE.DirectionalLight(0xfff0da, 2.6);
    key.position.set(3.5, 6, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -4.5;
    key.shadow.camera.right = key.shadow.camera.top = 4.5;
    key.shadow.camera.far = 20;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 6;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xcfe0ff, 0.8);
    rim.position.set(-4, 3, -4);
    this.scene.add(rim);

    const bounce = new THREE.HemisphereLight(0xfff6e6, 0xc9b694, 0.5);
    this.scene.add(bounce);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(16, 48),
      new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.target.set(0, 0.45, 0);
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 11;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minPolarAngle = Math.PI * 0.12;
    this.controls.enablePan = false;

    this.particles = new ParticleSystem(this.scene);

    this.trauma = 0;          // camera shake energy 0..1
    this._shakeT = 0;
    this._focus = null;       // {target, dist, t}

    this.clock = new THREE.Clock();

    addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /* glide the orbit target (and optionally distance) to a new point */
  focus(point, dist = null) {
    this._focus = { target: point.clone(), dist, t: 0 };
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 1 / 12);

    if (this._focus) {
      const f = this._focus;
      f.t += dt;
      const k = 1 - Math.exp(-dt * 4.5);
      this.controls.target.lerp(f.target, k);
      if (f.dist != null) {
        const cur = this.camera.position.distanceTo(this.controls.target);
        const next = THREE.MathUtils.lerp(cur, f.dist, k);
        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        this.camera.position.copy(this.controls.target).addScaledVector(dir, next);
      }
      if (f.t > 1.6) this._focus = null;
    }

    this.controls.update();
    this.particles.update(dt);

    // camera shake: render-only offset, restored afterwards so OrbitControls
    // never absorbs it (otherwise the camera random-walks with every impact)
    const savedPos = this.camera.position.clone();
    const savedRotZ = this.camera.rotation.z;
    if (this.trauma > 0.001) {
      this._shakeT += dt * 34;
      const p = this.trauma * this.trauma;
      this.camera.position.x += (Math.sin(this._shakeT * 1.3) + Math.sin(this._shakeT * 2.7) * 0.5) * 0.035 * p;
      this.camera.position.y += (Math.sin(this._shakeT * 1.7 + 2) + Math.sin(this._shakeT * 3.1) * 0.5) * 0.045 * p;
      this.camera.position.z += Math.sin(this._shakeT * 2.1 + 4) * 0.02 * p;
      this.camera.rotation.z += Math.sin(this._shakeT * 2.3) * 0.004 * p;
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
    this.renderer.render(this.scene, this.camera);
    this.camera.position.copy(savedPos);
    this.camera.rotation.z = savedRotZ;
    return dt;
  }
}
