// Stream stays open through the conversation. VAD segments answers after silence.
export function createContinuousMic({ onAnswer, onState, onError, canListen }) {
  let stream,
    context,
    source,
    analyser,
    timer,
    recorder,
    chunks,
    speechAt = 0,
    lastVoice = 0,
    startedAt = 0,
    noise = 0.004,
    muted = false,
    busy = false,
    generation = 0;
  const status = () =>
    onState?.({ muted, listening: !!recorder, speaking: !!speechAt });
  function discard() {
    const old = recorder;
    recorder = null;
    speechAt = lastVoice = 0;
    if (old?.state === "recording") {
      old.onstop = null;
      old.stop();
    }
    status();
  }
  function finish() {
    if (!recorder || !speechAt) return discard();
    const old = recorder,
      data = chunks,
      began = speechAt,
      current = generation;
    busy = true;
    recorder = null;
    speechAt = lastVoice = 0;
    status();
    old.onstop = async () => {
      if (current !== generation) return;
      try {
        const blob = new Blob(data, { type: old.mimeType || "audio/webm" });
        if (blob.size && Date.now() - began > 250) await onAnswer(blob);
      } catch (error) {
        onError?.(error);
      } finally {
        if (current === generation) busy = false;
      }
    };
    old.stop();
  }
  function begin() {
    chunks = [];
    speechAt = lastVoice = 0;
    startedAt = Date.now();
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
      (t) => MediaRecorder.isTypeSupported(t),
    );
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const data = chunks;
    recorder.ondataavailable = (e) => {
      if (e.data.size) data.push(e.data);
    };
    recorder.onerror = () => {
      discard();
      onError?.(
        new Error("Microphone recording failed. You can type your answer."),
      );
    };
    recorder.start(200);
    status();
  }
  function tick() {
    if (!stream || muted || busy || !canListen()) {
      if (recorder) discard();
      return;
    }
    try {
      if (!recorder) begin();
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
          samples.reduce((n, x) => n + x * x, 0) / samples.length,
        ),
        now = Date.now();
      if (rms > Math.max(0.012, noise * 3)) {
        if (!speechAt) {
          speechAt = now;
          status();
        }
        lastVoice = now;
      } else if (!speechAt) noise = noise * 0.98 + rms * 0.02;
      if (speechAt && (now - lastVoice > 1800 || now - speechAt > 90000))
        finish();
      else if (!speechAt && now - startedAt > 15000) discard();
    } catch (error) {
      discard();
      onError?.(error);
    }
  }
  return {
    async start(value) {
      this.stop();
      stream = value;
      muted = false;
      stream.getAudioTracks().forEach((t) => (t.enabled = true));
      context = new AudioContext();
      await context.resume();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      timer = setInterval(tick, 60);
      status();
    },
    toggleMute() {
      muted = !muted;
      stream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
      if (muted) {
        if (speechAt) finish();
        else discard();
      }
      status();
      return muted;
    },
    flush: finish,
    pause: discard,
    stop() {
      generation++;
      clearInterval(timer);
      discard();
      source?.disconnect();
      void context?.close();
      stream = context = source = analyser = null;
      busy = false;
      muted = false;
    },
  };
}
