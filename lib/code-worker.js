import { parentPort, workerData } from "node:worker_threads";
import { getQuickJS } from "quickjs-emscripten";
// Candidate code has no host bindings except console and a read-only stdin shim.
const engine = await getQuickJS();
const results = [];
for (const test of workerData.tests) {
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + 1000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  let stdout = "",
    stderr = "";
  const log = vm.newFunction("log", (...args) => {
    const line = args.map((arg) => String(vm.dump(arg))).join(" ") + "\n";
    if (stdout.length + line.length > 16000)
      throw new Error("Output exceeded 16 KB.");
    stdout += line;
  });
  const consoleObject = vm.newObject();
  vm.setProp(consoleObject, "log", log);
  vm.setProp(consoleObject, "error", log);
  vm.setProp(vm.global, "console", consoleObject);
  log.dispose();
  consoleObject.dispose();
  const bootstrap = `const __input = ${JSON.stringify(test.stdin)};
    const require = (name) => {
      if (name !== 'fs' && name !== 'node:fs') throw new Error('Only stdin via fs is supported.');
      return { readFileSync: (fd) => { if (fd !== 0 && fd !== '/dev/stdin') throw new Error('Only stdin is available.'); return __input; } };
    };`;
  const started = Date.now();
  try {
    const value = vm.evalCode(
      bootstrap + "\n" + workerData.code,
      "solution.js",
    );
    if (value.error) {
      const err = vm.dump(value.error);
      stderr = String(err?.message || err).slice(0, 2000);
      value.error.dispose();
    } else value.value.dispose();
    const pending = runtime.executePendingJobs(100);
    if (pending.error) {
      stderr = "An asynchronous task failed or exceeded the runtime limit.";
      pending.error.dispose();
    }
  } catch (error) {
    stderr = String(error.message).slice(0, 2000);
  } finally {
    vm.dispose();
    runtime.dispose();
  }
  results.push({
    stdin: test.stdin,
    expected: test.expected_output,
    stdout,
    stderr,
    compile_output: "",
    status: stderr ? "Runtime error" : "Completed",
    passed:
      !stderr &&
      stdout.trim().replace(/\r\n/g, "\n") ===
        test.expected_output.trim().replace(/\r\n/g, "\n"),
    time: ((Date.now() - started) / 1000).toFixed(3),
    memory: null,
  });
}
parentPort.postMessage(results);
