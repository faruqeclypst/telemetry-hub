/**
 * TelemetryHub Pro - Web Audio Synthetic GT3/WEC Engine Sound Synthesizer
 *
 * Generates dynamic multi-harmonic engine audio driven live by telemetry RPM,
 * throttle position, gear shifts, and exhaust deceleration pops.
 */

export function createEngineAudio() {
  let audioCtx = null;
  let isMuted = true;
  let masterGain = null;
  let osc1 = null;
  let osc2 = null;
  let subOsc = null;
  let filterNode = null;
  let distortionNode = null;
  let prevRpm = 4000;
  let prevThrottle = 0;
  let lastShiftTime = 0;
  let isInitialized = false;

  function init() {
    if (isInitialized) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();

      masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
      masterGain.connect(audioCtx.destination);

      // Low-pass filter for engine body and throttle roar
      filterNode = audioCtx.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.setValueAtTime(800, audioCtx.currentTime);
      filterNode.Q.setValueAtTime(2.5, audioCtx.currentTime);
      filterNode.connect(masterGain);

      // Wave shaper for exhaust rasp
      distortionNode = audioCtx.createWaveShaper();
      distortionNode.curve = makeDistortionCurve(18);
      distortionNode.oversample = '2x';
      distortionNode.connect(filterNode);

      // Main V8 cylinder firing frequency oscillator (Sawtooth)
      osc1 = audioCtx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(140, audioCtx.currentTime);

      const gain1 = audioCtx.createGain();
      gain1.gain.setValueAtTime(0.65, audioCtx.currentTime);
      osc1.connect(gain1);
      gain1.connect(distortionNode);

      // Secondary intake harmonic oscillator (Triangle/Square)
      osc2 = audioCtx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(280, audioCtx.currentTime);

      const gain2 = audioCtx.createGain();
      gain2.gain.setValueAtTime(0.35, audioCtx.currentTime);
      osc2.connect(gain2);
      gain2.connect(distortionNode);

      // Sub-bass rumble
      subOsc = audioCtx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(70, audioCtx.currentTime);

      const subGain = audioCtx.createGain();
      subGain.gain.setValueAtTime(0.4, audioCtx.currentTime);
      subOsc.connect(subGain);
      subGain.connect(filterNode);

      osc1.start();
      osc2.start();
      subOsc.start();

      isInitialized = true;
    } catch (e) {
      console.warn("Web Audio not supported or blocked", e);
    }
  }

  function makeDistortionCurve(amount) {
    const k = amount;
    const n = 256;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  return {
    toggleMute() {
      if (!isInitialized) init();
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      isMuted = !isMuted;
      if (masterGain && audioCtx) {
        const targetVol = isMuted ? 0 : 0.22;
        masterGain.gain.setTargetAtTime(targetVol, audioCtx.currentTime, 0.08);
      }
      return isMuted;
    },
    isMuted() {
      return isMuted;
    },
    update(telemetry, isPlaying) {
      if (!isInitialized || !audioCtx || !telemetry) return;
      if (audioCtx.state === 'suspended' && !isMuted) {
        audioCtx.resume();
      }

      const now = audioCtx.currentTime;
      if (!isPlaying || isMuted) {
        masterGain.gain.setTargetAtTime(0, now, 0.08);
        return;
      }

      // Smooth RPM frequency (V8 firing formula: rpm * 8 / 120)
      const rawRpm = Math.max(850, Math.min(8800, telemetry.rpm || 4200));
      const targetFreq = (rawRpm * 8) / 120;
      osc1.frequency.setTargetAtTime(targetFreq, now, 0.04);
      osc2.frequency.setTargetAtTime(targetFreq * 2.01, now, 0.04);
      subOsc.frequency.setTargetAtTime(targetFreq * 0.5, now, 0.05);

      // Throttle opens the filter and increases intake volume
      const throttle = Math.max(0, Math.min(100, telemetry.throttle || 0)) / 100;
      const targetFilterFreq = 650 + throttle * 2800 + (rawRpm / 8000) * 1200;
      filterNode.frequency.setTargetAtTime(targetFilterFreq, now, 0.05);

      // Volume dynamics: louder on throttle, deep grumble on overrun
      const baseVol = 0.14 + throttle * 0.16 + (rawRpm / 8000) * 0.08;
      masterGain.gain.setTargetAtTime(baseVol, now, 0.06);

      // Detect gear shift or sudden throttle lift for exhaust crackle
      if (prevThrottle > 70 && throttle < 20 && now - lastShiftTime > 0.4) {
        lastShiftTime = now;
        // Brief exhaust pop
        filterNode.frequency.setValueAtTime(targetFilterFreq * 1.5, now);
        filterNode.frequency.exponentialRampToValueAtTime(700, now + 0.08);
      }

      prevRpm = rawRpm;
      prevThrottle = throttle * 100;
    },
    dispose() {
      if (audioCtx) {
        try {
          audioCtx.close();
        } catch (_) {}
      }
    }
  };
}
