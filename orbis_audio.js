'use strict';

// 短い効果音を Web Audio API の波形合成だけで作る。
// 外部音源・サンプルは使わない。ミュート設定は API キーとは別の localStorage キーに保存する。
globalThis.ORBIS_AUDIO = (() => {
  const STORAGE_KEY = 'orbis_sound_muted_v1';
  const SOUND_IDS = Object.freeze(['turn', 'war', 'peace', 'focus']);
  const SOUND_INFO = Object.freeze({
    turn: { label: 'ターン終了', description: '低い二音で半月の終わりを告げる。' },
    war: { label: '宣戦', description: '低音の下降と短い打音で緊張を示す。' },
    peace: { label: '和平', description: '上昇する三和音で停戦を示す。' },
    focus: { label: '国策完了', description: '明るいアルペジオで国策の達成を示す。' }
  });

  function readMuted() {
    try {
      return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  let muted = readMuted();
  let audioContext = null;
  let lastPlayed = null;

  function isMuted() {
    return muted;
  }

  function setMuted(value) {
    muted = Boolean(value);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch { /* 端末保存が使えない場合もミュート状態は維持する */ }
    return muted;
  }

  function ensureContext() {
    if (audioContext) return audioContext;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioContext = new Ctor();
    } catch {
      audioContext = null;
    }
    return audioContext;
  }

  function tone(context, { frequency, start, duration, type = 'sine', gain = 0.05, endFrequency = null }) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function schedule(context, id, start) {
    if (id === 'turn') {
      tone(context, { frequency: 392, start, duration: 0.16, type: 'sine', gain: 0.045 });
      tone(context, { frequency: 523.25, start: start + 0.13, duration: 0.22, type: 'sine', gain: 0.04 });
      return;
    }
    if (id === 'war') {
      tone(context, { frequency: 164.81, start, duration: 0.32, type: 'sawtooth', gain: 0.035, endFrequency: 82.41 });
      tone(context, { frequency: 110, start: start + 0.2, duration: 0.38, type: 'triangle', gain: 0.05, endFrequency: 55 });
      return;
    }
    if (id === 'peace') {
      [261.63, 329.63, 392].forEach((frequency, index) => {
        tone(context, { frequency, start: start + index * 0.11, duration: 0.34, type: 'sine', gain: 0.04 });
      });
      return;
    }
    if (id === 'focus') {
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
        tone(context, { frequency, start: start + index * 0.075, duration: 0.2, type: 'triangle', gain: 0.035 });
      });
    }
  }

  function play(id, options = {}) {
    if (!SOUND_IDS.includes(id)) return false;
    if (muted) return false;
    const context = options.context || ensureContext();
    if (!context) return false;
    const start = Math.max(context.currentTime || 0, Number(options.start) || 0) + 0.01;
    schedule(context, id, start);
    lastPlayed = id;
    return true;
  }

  function setContextForTest(context) {
    audioContext = context || null;
  }

  function state() {
    return { muted, storageKey: STORAGE_KEY, sounds: SOUND_IDS.slice(), lastPlayed };
  }

  return Object.freeze({
    STORAGE_KEY,
    SOUND_IDS,
    SOUND_INFO,
    isMuted,
    setMuted,
    play,
    state,
    setContextForTest
  });
})();
