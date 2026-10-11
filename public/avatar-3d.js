import * as THREE from "three";
import { GLTFLoader } from "/vendor/three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "/vendor/three/examples/jsm/environments/RoomEnvironment.js";

// Complete, skinned characters: the head, eyes, hair and clothes share one rig.
// Asset credits and the Microsoft MIT license are in /assets/.
export function createAvatar3D(container, gender = "female") {
  container.replaceChildren();
  container.classList.add("human-avatar");
  delete container.dataset.ready;
  delete container.dataset.error;
  const status = document.createElement("div");
  status.className = "avatar-loading";
  status.setAttribute("role", "status");
  status.textContent = "Getting your interviewer ready…";
  container.append(status);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e2e9e3");
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
  const person = new THREE.Group();
  scene.add(person);
  scene.add(new THREE.HemisphereLight(0xfff7ee, 0x798d82, 0.9));
  const key = new THREE.DirectionalLight(0xfff4e6, 1.8);
  key.position.set(-2, 3, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe9f1ff, 0.7);
  fill.position.set(3, 2, 2);
  scene.add(fill);

  let renderer, environment, observer, frame, model, head, headRest;
  let disposed = false,
    speaking = false,
    mouth = 0,
    jaw = 0;
  let lastTime = performance.now(),
    elapsed = 0;
  let nextBlink = 2.5 + Math.random() * 2,
    blinkTime = -1;
  let portraitCenter = new THREE.Vector3(0, 1.4, 0);
  let portraitHeight = 0.8;
  const faces = [];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function release(root) {
    const geometries = new Set(),
      materials = new Set(),
      textures = new Set();
    root.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [object.material].flat().filter(Boolean)) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value?.isTexture) textures.add(value);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
  }

  function fitPortrait() {
    const width = container.clientWidth || 120;
    const height = container.clientHeight || 150;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Keep the entire hairstyle and both shoulders inside even narrow thumbnails.
    const visibleHeight = Math.max(
      portraitHeight,
      (portraitHeight * 0.78) / camera.aspect,
    );
    const distance =
      visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.position.set(
      portraitCenter.x,
      portraitCenter.y,
      portraitCenter.z + distance,
    );
    camera.lookAt(portraitCenter);
    camera.updateProjectionMatrix();
  }

  function expression(name, weight) {
    for (const { mesh, targets } of faces) {
      const index = targets[name];
      if (index !== undefined) mesh.morphTargetInfluences[index] = weight;
    }
  }

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.domElement.setAttribute(
      "aria-label",
      `Animated 3D ${gender === "male" ? "male" : "female"} interviewer`,
    );
    renderer.domElement.setAttribute("role", "img");
    container.prepend(renderer.domElement);
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(renderer);
    environment = generator.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.65;
    generator.dispose();
    room.dispose();
    observer = new ResizeObserver(fitPortrait);
    observer.observe(container);
    fitPortrait();

    const loader = new GLTFLoader();
    loader
      .loadAsync(`/assets/${gender === "male" ? "male" : "rachel"}.glb`)
      .then((asset) => {
        if (disposed) {
          release(asset.scene);
          return;
        }
        model = asset.scene;
        person.add(model);
        model.traverse((mesh) => {
          if (!mesh.morphTargetDictionary) return;
          const targets = {};
          for (const [name, index] of Object.entries(
            mesh.morphTargetDictionary,
          ))
            targets[name.split("_").at(-1)] = index;
          faces.push({ mesh, targets });
        });
        head = model.getObjectByName("Bip01_Head");
        headRest = head?.quaternion.clone();
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model, true);
        const size = bounds.getSize(new THREE.Vector3());
        portraitHeight = size.y * 0.34;
        portraitCenter.set(
          (bounds.min.x + bounds.max.x) / 2,
          bounds.max.y - portraitHeight * 0.43,
          (bounds.min.z + bounds.max.z) / 2,
        );
        fitPortrait();
        status.remove();
        container.dataset.ready = "true";
      })
      .catch(() => {
        if (disposed) return;
        container.dataset.error = "true";
        status.className = "avatar-loading avatar-fallback";
        status.textContent =
          "Interviewer preview unavailable. You can still continue your interview.";
      });

    function animate(now) {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const delta = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      if (!container.offsetParent || document.hidden) return;
      elapsed += delta;
      if (model) {
        // Damp audio peaks: closed lips while listening, gentle varied mouth poses
        // while speaking. No vertex stretching or floating eyeballs.
        jaw = THREE.MathUtils.damp(jaw, speaking ? mouth : 0, 14, delta);
        const phase = (Math.sin(elapsed * 7.5) + 1) / 2;
        expression("aa", jaw * 0.42);
        expression("E", jaw * phase * 0.16);
        expression("O", jaw * (1 - phase) * 0.16);
        const smile = speaking ? 0.08 : 0.16;
        expression("MouthSmileLeft", smile);
        expression("MouthSmileRight", smile);
        expression("CheekSquintLeft", 0.025);
        expression("CheekSquintRight", 0.025);
        let closed = 0;
        if (!reducedMotion) {
          if (elapsed >= nextBlink && blinkTime < 0) blinkTime = 0;
          if (blinkTime >= 0) {
            blinkTime += delta;
            closed =
              blinkTime < 0.09
                ? blinkTime / 0.09
                : Math.max(0, 1 - (blinkTime - 0.09) / 0.17);
            if (blinkTime >= 0.26) {
              blinkTime = -1;
              nextBlink = elapsed + 3 + Math.random() * 4;
            }
          }
          person.position.y = Math.sin(elapsed * 1.4) * 0.002;
          person.rotation.y = Math.sin(elapsed * 0.55) * 0.018;
          if (head)
            head.quaternion
              .copy(headRest)
              .multiply(
                new THREE.Quaternion().setFromEuler(
                  new THREE.Euler(
                    Math.sin(elapsed * 0.7) * 0.012,
                    Math.sin(elapsed * 0.9) * 0.008,
                    0,
                  ),
                ),
              );
        }
        expression("EyeBlinkLeft", closed);
        expression("EyeBlinkRight", closed);
      }
      renderer.render(scene, camera);
    }
    frame = requestAnimationFrame(animate);
  } catch {
    status.className = "avatar-loading avatar-fallback";
    status.textContent = "3D view unavailable on this device";
    container.dataset.error = "true";
  }

  return {
    mouth(value) {
      mouth = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
    },
    speaking(on) {
      speaking = Boolean(on);
      if (!on) mouth = 0;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      release(scene);
      environment?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      container.replaceChildren();
      delete container.dataset.ready;
    },
  };
}
