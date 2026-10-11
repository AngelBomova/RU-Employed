export function createCameraCoach(onStatus) {
  let worker,
    interval,
    ready = false,
    pending = false,
    capture = false,
    generation = 0,
    previous;
  let counts = {
    samples: 0,
    visible: 0,
    cameraFacing: 0,
    framed: 0,
    movement: 0,
    movementSamples: 0,
  };
  function stop() {
    generation++;
    clearInterval(interval);
    worker?.terminate();
    worker = null;
    ready = pending = false;
  }
  return {
    reset() {
      stop();
      previous = null;
      counts = {
        samples: 0,
        visible: 0,
        cameraFacing: 0,
        framed: 0,
        movement: 0,
        movementSamples: 0,
      };
    },
    async start(video, canSample) {
      stop();
      const current = generation;
      worker = new Worker("/camera-worker.js");
      onStatus("Preparing private webcam coaching…");
      worker.onmessage = ({ data }) => {
        if (current !== generation) return;
        pending = false;
        if (data.type === "ready") {
          ready = true;
          onStatus("Camera coaching on · frames stay on this device");
        }
        if (data.type === "error") {
          console.warn("Camera model:", data.message);
          onStatus("Camera coaching unavailable. Preview still works.");
          stop();
        }
        if (data.type === "sample") {
          counts.samples++;
          if (!data.visible) {
            previous = null;
            return;
          }
          counts.visible++;
          counts.cameraFacing += Number(data.cameraFacing);
          counts.framed += Number(data.framed);
          if (previous) {
            counts.movement +=
              data.expression.reduce(
                (n, v, i) => n + Math.abs(v - previous[i]),
                0,
              ) / data.expression.length;
            counts.movementSamples++;
          }
          previous = data.expression;
        }
      };
      worker.onerror = () => {
        onStatus("Camera coaching unavailable. Preview still works.");
        stop();
      };
      worker.postMessage({ type: "init" });
      interval = setInterval(async () => {
        if (
          !ready ||
          pending ||
          capture ||
          video.readyState < 2 ||
          !canSample()
        )
          return;
        capture = true;
        try {
          const frame = await createImageBitmap(video, {
            resizeWidth: 320,
            resizeHeight: 240,
          });
          if (current !== generation) {
            frame.close();
            return;
          }
          pending = true;
          worker.postMessage(
            { type: "frame", frame, timestamp: performance.now() },
            [frame],
          );
        } catch {
          pending = false;
        } finally {
          capture = false;
        }
      }, 400);
    },
    stop,
    summary() {
      return counts.samples
        ? {
            samples: counts.samples,
            seconds: Math.round(counts.samples * 0.4),
            faceVisible: counts.visible / counts.samples,
            cameraFacing: counts.visible
              ? counts.cameraFacing / counts.visible
              : null,
            framing: counts.visible ? counts.framed / counts.visible : null,
            facialMovement: counts.movementSamples
              ? counts.movement / counts.movementSamples
              : null,
          }
        : null;
    },
  };
}
