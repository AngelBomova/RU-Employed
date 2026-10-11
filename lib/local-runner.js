import { Worker } from "node:worker_threads";
import { failure } from "./security.js";
let active = 0;
export function executeJavaScript(code, tests) {
  if (active >= 2)
    throw failure(429, "The local code sandbox is busy. Try again shortly.");
  active++;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./code-worker.js", import.meta.url), {
      workerData: { code, tests },
      resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
    });
    let finished = false;
    const done = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      active--;
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(
      () => done(failure(408, "Code exceeded the sandbox time limit.")),
      9000,
    );
    worker.once("message", (results) => done(null, results));
    worker.once("error", () =>
      done(failure(422, "Code exceeded sandbox limits or failed to execute.")),
    );
    worker.once("exit", () => {
      if (!finished)
        done(failure(422, "The sandbox ended before producing results."));
    });
  });
}
