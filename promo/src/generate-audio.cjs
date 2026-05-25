const fs = require('fs');
const path = require('path');

function generateWav(filename, frequencies, duration, decay, volume = 0.3) {
  const sampleRate = 44100;
  const samples = Math.floor(sampleRate * duration);
  const buffer = Buffer.alloc(44 + samples * 2);

  // WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * decay) * volume;
    let sample = 0;
    for (let j = 0; j < frequencies.length; j++) {
      const freq = frequencies[j];
      const delay = j * 0.05;
      if (t >= delay) {
        sample += Math.sin(2 * Math.PI * freq * (t - delay)) / frequencies.length;
      }
    }
    const val = Math.max(-1, Math.min(1, sample * envelope));
    buffer.writeInt16LE(Math.floor(val * 0x7FFF), 44 + i * 2);
  }

  fs.writeFileSync(path.join(__dirname, '..', 'public', filename), buffer);
  console.log(`Generated: ${filename}`);
}

// Activate sound - bright ascending chime
generateWav('activate.wav', [880, 1108, 1318], 0.4, 6, 0.25);

// Recording start - soft pop
generateWav('record-start.wav', [600, 900], 0.2, 12, 0.3);

// Complete sound - triumphant chord
generateWav('complete.wav', [523, 659, 784, 1046], 0.8, 3, 0.25);

// Question sound - two-tone alert
generateWav('question.wav', [587, 440], 0.5, 5, 0.2);

// Keystroke sound - mechanical click
function generateClick(filename) {
  const sampleRate = 44100;
  const duration = 0.08;
  const samples = Math.floor(sampleRate * duration);
  const buffer = Buffer.alloc(44 + samples * 2);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const noise = (Math.random() * 2 - 1) * 0.4;
    const tone = Math.sin(2 * Math.PI * 3500 * t) * 0.3;
    const envelope = Math.exp(-t * 60);
    const val = (noise + tone) * envelope;
    buffer.writeInt16LE(Math.floor(Math.max(-1, Math.min(1, val)) * 0x7FFF), 44 + i * 2);
  }

  fs.writeFileSync(path.join(__dirname, '..', 'public', filename), buffer);
  console.log(`Generated: ${filename}`);
}

generateClick('keystroke.wav');

console.log('All sound effects generated!');
