importScripts("/vendor/mediapipe/vision_bundle.js");
const { FaceLandmarker, FilesetResolver } = Vision;
let model;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      const files = await FilesetResolver.forVisionTasks(
        "/vendor/mediapipe/wasm",
      );
      model = await FaceLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "/assets/face_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", message: String(error.message) });
    }
    return;
  }
  if (data.type !== "frame") return;
  try {
    const result = model.detectForVideo(data.frame, data.timestamp);
    const points = result.faceLandmarks[0];
    if (!points) return self.postMessage({ type: "sample", visible: false });
    const blends = Object.fromEntries(
      result.faceBlendshapes[0]?.categories.map((c) => [
        c.categoryName,
        c.score,
      ]) || [],
    );
    const eyeLeft = points[33],
      eyeRight = points[263],
      nose = points[1];
    const headOffset =
      Math.abs(nose.x - (eyeLeft.x + eyeRight.x) / 2) /
      Math.max(0.001, Math.abs(eyeRight.x - eyeLeft.x));
    const lookingAway = Math.max(
      ...Object.entries(blends)
        .filter(([k]) => k.startsWith("eyeLook"))
        .map(([, v]) => v),
      0,
    );
    const minX = Math.min(...points.map((p) => p.x)),
      maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y)),
      maxY = Math.max(...points.map((p) => p.y));
    self.postMessage({
      type: "sample",
      visible: true,
      cameraFacing: headOffset < 0.24 && lookingAway < 0.48,
      framed:
        minX > 0.03 &&
        maxX < 0.97 &&
        minY > 0.025 &&
        maxY < 0.975 &&
        maxX - minX > 0.16,
      expression: [
        blends.mouthSmileLeft || 0,
        blends.mouthSmileRight || 0,
        blends.browInnerUp || 0,
        blends.browOuterUpLeft || 0,
        blends.browOuterUpRight || 0,
      ],
    });
  } catch (error) {
    self.postMessage({ type: "error", message: String(error.message) });
  } finally {
    data.frame.close();
  }
};
