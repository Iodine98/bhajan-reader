/**
 * audio.js — microphone onset detection using the Web Audio API.
 *
 * Detects acoustic onsets (syllable/word beginnings) by comparing
 * the current RMS energy to a slow-moving background average.
 * When the ratio exceeds `threshold` and the refractory period has
 * elapsed, an onset event fires and calls `this.onOnset()`.
 */
export class AudioOnsetDetector {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this._rafId = null;
    this.isRunning = false;

    // Configurable parameters
    this.threshold = 2.5;      // onset fires when rms > background * threshold
    this.refractoryMs = 300;   // minimum ms between onsets

    // Internal state
    this._backgroundRms = 0;
    this._lastOnsetTime = -Infinity;
    this._ALPHA = 0.95;        // smoothing factor for background (slow)
    this._SILENCE_FLOOR = 0.005;

    /** Called with no arguments when an onset is detected. */
    this.onOnset = null;

    /** Called with rms value (0–1 approx) each animation frame. */
    this.onRms = null;
  }

  /** Request mic access and start the analysis loop. Throws on permission denial. */
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);

    this._backgroundRms = 0;
    this._lastOnsetTime = -Infinity;
    this.isRunning = true;
    this._loop();
  }

  /** Stop and release all resources. */
  stop() {
    this.isRunning = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.audioContext) this.audioContext.close();
    this._rafId = null;
    this.stream = null;
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this._backgroundRms = 0;
  }

  setThreshold(value) { this.threshold = Number(value); }
  setRefractory(value) { this.refractoryMs = Number(value); }

  // ── private ───────────────────────────────────────────────────────────────

  _loop() {
    if (!this.isRunning) return;
    this._rafId = requestAnimationFrame(() => this._loop());

    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);

    // Compute RMS
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);

    this.onRms?.(rms);

    // Update background
    if (this._backgroundRms === 0) {
      this._backgroundRms = rms;
    } else {
      this._backgroundRms = this._ALPHA * this._backgroundRms + (1 - this._ALPHA) * rms;
    }

    const now = performance.now();
    const aboveBackground = rms > this._backgroundRms * this.threshold;
    const aboveSilence = rms > this._SILENCE_FLOOR;
    const refractoryPassed = now - this._lastOnsetTime > this.refractoryMs;

    if (aboveBackground && aboveSilence && refractoryPassed) {
      this._lastOnsetTime = now;
      this.onOnset?.();
    }
  }
}
