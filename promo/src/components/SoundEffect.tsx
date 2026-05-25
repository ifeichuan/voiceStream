import {useCurrentFrame, useVideoConfig, Sequence, Audio} from 'remotion';

interface SoundEffectProps {
  triggerFrame: number;
  type: 'activate' | 'complete' | 'question';
}

export const SoundEffect: React.FC<SoundEffectProps> = ({triggerFrame, type}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const frequencies: Record<string, number[]> = {
    activate: [440, 554, 659],
    complete: [523, 659, 784],
    question: [392, 494],
  };

  const freq = frequencies[type] || [440];
  const duration = type === 'complete' ? 0.6 : 0.3;

  const generateTone = (): string => {
    const sampleRate = 44100;
    const samples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(samples);

    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * 5) * 0.3;
      let sample = 0;
      for (const f of freq) {
        sample += Math.sin(2 * Math.PI * f * t) / freq.length;
      }
      buffer[i] = sample * envelope;
    }

    const wavBuffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(wavBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples * 2, true);

    for (let i = 0; i < samples; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i]));
      view.setInt16(44 + i * 2, s * 0x7FFF, true);
    }

    const blob = new Blob([wavBuffer], {type: 'audio/wav'});
    return URL.createObjectURL(blob);
  };

  if (frame < triggerFrame) return null;

  return null;
};
