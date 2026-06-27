/**
 * speech.js — speech recognition: Web Speech API (Chrome) or
 * server-side transcription via /api/transcribe (Firefox fallback).
 */

/**
 * Transliterate Devanagari characters to approximate Latin equivalents.
 *
 * The hi-IN speech recognizer returns Devanagari text (e.g. "भूर्भुवः").
 * This map converts each character to a rough ASCII equivalent so the result
 * can be Levenshtein-matched against the IAST-normalised reference words.
 * e.g. "भूर्भुवः" → "bhuurbhuvh"
 *
 * The mapping intentionally collapses many distinctions (retroflex vs. dental,
 * long vs. short vowels) because speech recognisers already lose that detail.
 */
const _DEVA = {
  // Vowel letters
  'अ':'a','आ':'aa','इ':'i','ई':'ii','उ':'u','ऊ':'uu','ऋ':'ri',
  'ए':'e','ऐ':'ai','ओ':'o','औ':'au',
  // Vowel signs (matras)
  'ा':'a','ि':'i','ी':'i','ु':'u','ू':'u','ृ':'ri',
  'े':'e','ै':'ai','ो':'o','ौ':'au',
  // Consonants
  'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'n',
  'च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'n',
  'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n',
  'त':'t','थ':'th','द':'d','ध':'dh','न':'n',
  'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m',
  'य':'y','र':'r','ल':'l','व':'v',
  'श':'sh','ष':'sh','स':'s','ह':'h',
  // Specials
  'ं':'m','ः':'h','्':'','ँ':'n',  // anusvara, visarga, virama, chandrabindu
  'ॐ':'om',
};
export function devanagariToLatin(text) {
  return [...text.replace(/ॐ/g, 'om')].map(ch => _DEVA[ch] ?? ch).join('');
}

/**
 * Strip IAST diacritics and normalise to lowercase ASCII alpha.
 * e.g. "bhūrbhuvaḥ" → "bhurbhuvah"
 */
export function normalizeRom(text) {
  return text
    .normalize('NFD')
    // Remove combining diacritical marks
    .replace(/[\u0300-\u036f]/g, '')
    // IAST-specific replacements that survive NFD decomposition
    .replace(/ṃ/g, 'm').replace(/ṁ/g, 'm')
    .replace(/ḥ/g, 'h')
    .replace(/ṭ/g, 't').replace(/ḍ/g, 'd')
    .replace(/ṇ/g, 'n').replace(/ñ/g, 'n')
    .replace(/ś/g, 's').replace(/ṣ/g, 's')
    .replace(/ḷ/g, 'l')
    .replace(/ṛ/g, 'r')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

const BASE = window.BACKEND_URL || '';

export class SpeechRecognizer {
  constructor() {
    this.lang = 'hi-IN';
    this.onWords = null;
    this.onError = null;
    this.onRms = null;
    this.isRunning = false;
    this._recognition = null;
    this._meterStream = null;
    this._meterCtx = null;
    this._meterRaf = null;
  }

  static isSupported() {
    return !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  }

  start() {
    if (this.isRunning) return;
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onresult = e => {
      if (!this.onWords) return;
      // Process only the latest result
      const result = e.results[e.results.length - 1];
      const words = [];
      for (let i = 0; i < result.length; i++) {
        const tokens = result[i].transcript.trim().toLowerCase().split(/\s+/);
        words.push(...tokens);
      }
      this.onWords(words);
    };

    rec.onend = () => {
      if (this.isRunning) {
        // Auto-restart on silence
        try { rec.start(); } catch (_) {}
      }
    };

    rec.onerror = e => {
      if (e.error === 'no-speech') return; // normal silence
      if (this.onError) this.onError(e.error);
    };

    this._recognition = rec;
    this.isRunning = true;
    rec.start();

    // Open a parallel audio pipeline just for the VU meter.
    // The Web Speech API doesn't expose audio samples, so we need a second stream.
    this._startMeter();
  }

  async _startMeter() {
    try {
      this._meterStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._meterCtx = new AudioContext();
      const source = this._meterCtx.createMediaStreamSource(this._meterStream);
      const analyser = this._meterCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (!this.isRunning) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        if (this.onRms) this.onRms(Math.sqrt(sum / buf.length));
        this._meterRaf = requestAnimationFrame(tick);
      };
      this._meterRaf = requestAnimationFrame(tick);
    } catch (_) {
      // VU meter is a non-critical cosmetic feature — silently swallow permission
      // errors (e.g. NotAllowedError) so mic onset detection still works even
      // when a second getUserMedia call is denied by the browser policy.
    }
  }

  stop() {
    this.isRunning = false;
    if (this._meterRaf) { cancelAnimationFrame(this._meterRaf); this._meterRaf = null; }
    if (this._meterStream) { this._meterStream.getTracks().forEach(t => t.stop()); this._meterStream = null; }
    if (this._meterCtx) { this._meterCtx.close(); this._meterCtx = null; }
    if (this._recognition) {
      try { this._recognition.abort(); } catch (_) {}
      this._recognition = null;
    }
  }
}

/**
 * ServerSpeechRecognizer — records PCM audio via Web Audio API,
 * encodes it as WAV, and POSTs each ~3-second chunk to /api/transcribe.
 * Works in any browser that supports getUserMedia (including Firefox).
 */
export class ServerSpeechRecognizer {
  constructor() {
    this.lang = 'hi-IN';
    this.onWords = null;
    this.onError = null;
    this.onRms = null;
    this.isRunning = false;
    this._audioCtx = null;
    this._processor = null;
    this._stream = null;
    this._samples = [];
    this._timer = null;
    this._chunkSecs = 3;
  }

  /** Check that the server has speech_recognition installed. */
  static async checkServerSupport() {
    try {
      const r = await fetch(`${BASE}/api/transcribe-check`);
      return r.ok;
    } catch {
      return false;
    }
  }

  /**
   * Request mic permission, verify server support, then start recording.
   * Throws a plain Error with a human-readable message on failure.
   */
  async start() {
    if (this.isRunning) return;

    // Verify server has speech_recognition before asking for mic permission
    const r = await fetch(`${BASE}/api/transcribe-check`);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error ?? 'Server transcription unavailable. Run: pip install SpeechRecognition');
    }

    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this._audioCtx = new AudioContext();
    const source = this._audioCtx.createMediaStreamSource(this._stream);

    // ScriptProcessorNode is deprecated but universally supported (incl. Firefox).
    // bufferSize=4096 gives ~93ms latency at 44.1kHz — fine for chunked upload.
    const bufferSize = 4096;
    this._processor = this._audioCtx.createScriptProcessor(bufferSize, 1, 1);
    this._processor.onaudioprocess = e => {
      if (!this.isRunning) return;
      const data = e.inputBuffer.getChannelData(0);
      // Copy channel data — the Float32Array is reused by the browser
      this._samples.push(...data);
      // Compute RMS for VU meter
      if (this.onRms) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        this.onRms(Math.sqrt(sum / data.length));
      }
    };

    source.connect(this._processor);
    this._processor.connect(this._audioCtx.destination);
    this.isRunning = true;

    this._timer = setInterval(() => this._sendChunk(), this._chunkSecs * 1000);
  }

  stop() {
    this.isRunning = false;
    clearInterval(this._timer);
    this._timer = null;
    if (this._processor) { this._processor.disconnect(); this._processor = null; }
    if (this._audioCtx) { this._audioCtx.close(); this._audioCtx = null; }
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    this._samples = [];
  }

  async _sendChunk() {
    if (!this._samples.length) return;
    const samples = this._samples.splice(0); // consume accumulated samples
    const sampleRate = this._audioCtx?.sampleRate ?? 44100;
    const wav = _encodeWav(samples, sampleRate);
    try {
      const r = await fetch(`${BASE}/api/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav', 'X-Lang': this.lang },
        body: wav,
      });
      if (r.ok) {
        const { transcript } = await r.json();
        if (transcript && this.onWords) {
          this.onWords(transcript.trim().toLowerCase().split(/\s+/));
        }
      } else {
        const { error } = await r.json().catch(() => ({}));
        if (this.onError) this.onError(error ?? `HTTP ${r.status}`);
      }
    } catch (err) {
      if (this.onError) this.onError(err.message);
    }
  }
}

/** Encode Float32 PCM samples as a WAV ArrayBuffer. */
function _encodeWav(samples, sampleRate) {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, samples[i] * 32767));
  }
  const dataLen = int16.byteLength;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true);          // PCM chunk size
  v.setUint16(20, 1, true);           // PCM format
  v.setUint16(22, 1, true);           // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true);           // block align
  v.setUint16(34, 16, true);          // bits per sample
  str(36, 'data'); v.setUint32(40, dataLen, true);
  new Int16Array(buf, 44).set(int16);
  return buf;
}
