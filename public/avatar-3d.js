import * as THREE from "three";
import { GLTFLoader } from "/vendor/three/examples/jsm/loaders/GLTFLoader.js";
export function createAvatar3D(container, gender = "female") {
  container.replaceChildren();
  container.classList.add("human-avatar");
  let renderer,
    frame,
    observer,
    disposed = false,
    mouth = 0,
    speaking = false,
    mesh,
    original,
    eyes = [];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d9e3dc");
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 1.25, container.id === "coding-avatar" ? 6.6 : 7.8);
  camera.lookAt(0, 0.85, 0);
  const person = new THREE.Group();
  scene.add(person);
  scene.add(new THREE.HemisphereLight(0xfff8eb, 0x506257, 2.3));
  const key = new THREE.DirectionalLight(0xffe9d0, 3);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe4f4ff, 2);
  rim.position.set(3, 3, -2);
  scene.add(rim);
  const material = (color, roughness = 0.8) =>
    new THREE.MeshStandardMaterial({ color, roughness });
  function shape(geometry, color, position, scale, parent = person) {
    const obj = new THREE.Mesh(geometry, material(color));
    obj.position.set(...position);
    obj.scale.set(...scale);
    parent.add(obj);
    return obj;
  }
  // Adult torso, shirt, blazer, neck and hair are original procedural geometry.
  shape(
    new THREE.SphereGeometry(1, 32, 24),
    "#283d3c",
    [0, -1.32, -0.15],
    [1.48, 1.5, 0.65],
  );
  shape(
    new THREE.BoxGeometry(1, 1, 1),
    "#edf0e9",
    [0, -0.77, 0.43],
    [0.57, 1.22, 0.12],
  );
  const left = shape(
    new THREE.BoxGeometry(1, 1, 1),
    "#1c3030",
    [-0.4, -0.72, 0.48],
    [0.25, 1.1, 0.1],
  );
  left.rotation.z = -0.25;
  const right = shape(
    new THREE.BoxGeometry(1, 1, 1),
    "#1c3030",
    [0.4, -0.72, 0.48],
    [0.25, 1.1, 0.1],
  );
  right.rotation.z = 0.25;
  shape(
    new THREE.CylinderGeometry(0.26, 0.34, 1, 32),
    "#c08f76",
    [0, 0, -0.08],
    [1, 1, 1],
  );
  const head = new THREE.Group();
  head.position.y = 0.92;
  person.add(head);
  const plant = shape(
    new THREE.CylinderGeometry(0.16, 0.22, 0.6, 16),
    "#6c816c",
    [2, -0.8, -2],
    [1, 1, 1],
    scene,
  );
  for (let i = 0; i < 5; i++) {
    const leaf = shape(
      new THREE.SphereGeometry(1, 16, 12),
      "#526a57",
      [2 + (i - 2) * 0.13, -0.15 + i * 0.15, -2],
      [0.15, 0.65, 0.08],
      scene,
    );
    leaf.rotation.z = (i - 2) * 0.25;
  }
  shape(
    new THREE.BoxGeometry(1, 1, 1),
    "#f2eee3",
    [-2, 1, -2.5],
    [1.5, 2, 0.08],
    scene,
  );
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute(
      "aria-label",
      "Animated 3D human interviewer",
    );
    renderer.domElement.setAttribute("role", "img");
    container.append(renderer.domElement);
    observer = new ResizeObserver(() => {
      const w = container.clientWidth || 400,
        h = container.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    observer.observe(container);
    const loader = new GLTFLoader();
    loader.load(
      "/assets/interviewer-head.glb",
      (gltf) => {
        if (disposed) return;
        const source =
          gltf.scene.children.find((x) => x.isMesh) || gltf.scene.children[0];
        const geometry = source.geometry.clone();
        geometry.computeBoundingBox();
        const size = geometry.boundingBox.getSize(new THREE.Vector3()),
          center = geometry.boundingBox.getCenter(new THREE.Vector3());
        geometry.translate(-center.x, -center.y, -center.z);
        geometry.scale(2.25 / size.y, 2.25 / size.y, 2.25 / size.y);
        // The scan includes bare shoulders. Trim the bust so it joins the clothed torso.
        const positions = geometry.attributes.position,
          indices =
            geometry.index?.array ||
            Array.from({ length: positions.count }, (_, i) => i),
          clipped = [];
        for (let i = 0; i < indices.length; i += 3) {
          const a = indices[i],
            b = indices[i + 1],
            c = indices[i + 2];
          if (
            Math.min(positions.getY(a), positions.getY(b), positions.getY(c)) >
            -0.48
          )
            clipped.push(a, b, c);
        }
        geometry.setIndex(clipped);
        const skin = new THREE.TextureLoader().load(
          "/assets/interviewer-skin.jpg",
        );
        skin.colorSpace = THREE.SRGBColorSpace;
        // This geometry uses the original scan UVs, matching TextureLoader's flipY.
        const normal = new THREE.TextureLoader().load(
          "/assets/interviewer-normal.jpg",
        );
        mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            map: skin,
            normalMap: normal,
            normalScale: new THREE.Vector2(0.6, 0.6),
            roughness: 0.78,
          }),
        );
        head.add(mesh);
        original = new Float32Array(geometry.attributes.position.array);
        // The scan has closed eyelids. Add inset eyes that face the camera and blink.
        for (const x of [-0.18, 0.18]) {
          let depth = -Infinity;
          for (let i = 0; i < positions.count; i++)
            if (
              Math.abs(positions.getX(i) - x) < 0.07 &&
              Math.abs(positions.getY(i) - 0.49) < 0.035
            )
              depth = Math.max(depth, positions.getZ(i));
          if (!Number.isFinite(depth)) continue;
          const eye = new THREE.Group();
          eye.position.set(x, 0.49, depth + 0.015);
          head.add(eye);
          eyes.push(eye);
          shape(
            new THREE.SphereGeometry(1, 24, 16),
            "#e7e0d1",
            [0, 0, 0],
            [0.076, 0.025, 0.025],
            eye,
          );
          shape(
            new THREE.SphereGeometry(1, 20, 16),
            "#536359",
            [0, 0, 0.025],
            [0.026, 0.024, 0.007],
            eye,
          );
          shape(
            new THREE.SphereGeometry(1, 16, 12),
            "#1e2623",
            [0, 0, 0.032],
            [0.012, 0.019, 0.004],
            eye,
          );
        }
        // Hair follows the head silhouette; adult proportions replace the cartoon mascot.
        if (gender === "female") {
          shape(
            new THREE.SphereGeometry(1, 32, 24),
            "#302723",
            [0, 0.95, -0.14],
            [0.54, 0.22, 0.48],
            head,
          );
          shape(
            new THREE.SphereGeometry(1, 32, 24),
            "#302723",
            [0, 0.38, -0.45],
            [0.74, 0.88, 0.5],
            head,
          );
          for (const x of [-0.58, 0.58])
            shape(
              new THREE.SphereGeometry(1, 24, 20),
              "#302723",
              [x, -0.25, -0.27],
              [0.14, 0.75, 0.24],
              head,
            );
        } else
          shape(
            new THREE.SphereGeometry(1, 32, 24),
            "#352e29",
            [0, 0.95, -0.18],
            [0.58, 0.24, 0.47],
            head,
          );
        container.dataset.ready = "true";
      },
      undefined,
      () => {
        container.dataset.error = "true";
      },
    );
    const loop = () => {
      if (disposed) return;
      frame = requestAnimationFrame(loop);
      if (!container.offsetParent || document.hidden) return;
      const t = performance.now() / 1000;
      head.rotation.y = Math.sin(t * 0.65) * 0.045;
      head.rotation.x = Math.sin(t * 1.1) * 0.016;
      eyes.forEach((eye) => {
        eye.scale.y = t % 5.5 > 5.35 ? 0.08 : 1;
      });
      person.position.y = Math.sin(t * 1.2) * 0.015;
      if (mesh && original) {
        const p = mesh.geometry.attributes.position,
          jaw = mouth * (speaking ? 1 : 0.5);
        for (let i = 0; i < p.count; i++) {
          const x = original[i * 3],
            y = original[i * 3 + 1],
            z = original[i * 3 + 2];
          const weight =
            Math.max(0, 1 - Math.abs(x) / 0.55) *
            Math.max(0, 1 - Math.abs(y + 0.08) / 0.27) *
            (z > 0.25 ? 1 : 0);
          p.setY(i, y - weight * jaw * 0.075);
        }
        p.needsUpdate = true;
      }
      renderer.render(scene, camera);
    };
    loop();
  } catch {
    container.innerHTML =
      '<div class="avatar-fallback">3D view unavailable on this device</div>';
  }
  return {
    mouth(value) {
      mouth = Math.min(1, Math.max(0, value));
    },
    speaking(on) {
      speaking = on;
      if (!on) mouth = 0;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          o.material.map?.dispose();
          o.material.normalMap?.dispose();
          o.material.dispose();
        }
      });
      renderer?.dispose();
      renderer?.forceContextLoss();
      container.replaceChildren();
    },
  };
}
