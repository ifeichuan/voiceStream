import {AbsoluteFill, Sequence, Audio, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {PersistentOrb} from './components/PersistentOrb';
import {getOrbState, CAMERA_FOLLOW} from './orbState';
import {SlowPolishScene} from './scenes/SlowPolishScene';
import {FastFlashScene} from './scenes/FastFlashScene';
import {YourWayScene} from './scenes/YourWayScene';
import {AgentEchoScene} from './scenes/AgentEchoScene';
import {ThesisScene} from './scenes/ThesisScene';
import {LogoScene} from './scenes/LogoScene';

// Timeline (60s @ 30fps = 1800 frames)
//   0-120  (4s)   Opening — PersistentOrb scales up at center
//   120-540  (14s)  SlowPolishScene
//   540-840  (10s)  FastFlashScene
//   840-1140 (10s)  YourWayScene
//   1140-1560 (14s) AgentEchoScene (climax: amber → green TTS reply)
//   1560-1740 (6s)  ThesisScene
//   1740-1800 (2s)  LogoScene

export const Promo: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {pxX, pxY} = getOrbState(frame, fps);

  // Camera follows ORB inversely — when ORB flies right, scene drifts left.
  const camX = -pxX * CAMERA_FOLLOW;
  const camY = -pxY * CAMERA_FOLLOW;

  return (
    <AbsoluteFill style={{backgroundColor: '#050505'}}>
      {/* Camera-tracked layer: scenes + ORB share a single transform */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${camX}px, ${camY}px)`,
          willChange: 'transform',
        }}
      >
        <Sequence from={120} durationInFrames={420}>
          <SlowPolishScene />
        </Sequence>
        <Sequence from={540} durationInFrames={300}>
          <FastFlashScene />
        </Sequence>
        <Sequence from={840} durationInFrames={300}>
          <YourWayScene />
        </Sequence>
        <Sequence from={1140} durationInFrames={420}>
          <AgentEchoScene />
        </Sequence>
        <Sequence from={1560} durationInFrames={180}>
          <ThesisScene />
        </Sequence>
        <Sequence from={1740} durationInFrames={60}>
          <LogoScene />
        </Sequence>

        <PersistentOrb />
      </div>

      {/* Audio stays outside the camera transform */}
      <Sequence from={20} durationInFrames={20}>
        <Audio src={staticFile('activate.wav')} volume={0.4} />
      </Sequence>
      <Sequence from={140} durationInFrames={10}>
        <Audio src={staticFile('keystroke.wav')} volume={0.7} />
      </Sequence>
      <Sequence from={142} durationInFrames={20}>
        <Audio src={staticFile('record-start.wav')} volume={0.4} />
      </Sequence>

      <Sequence from={1155} durationInFrames={10}>
        <Audio src={staticFile('keystroke.wav')} volume={0.7} />
      </Sequence>
      <Sequence from={1157} durationInFrames={20}>
        <Audio src={staticFile('activate.wav')} volume={0.5} />
      </Sequence>

      <Sequence from={1420} durationInFrames={30}>
        <Audio src={staticFile('complete.wav')} volume={0.5} />
      </Sequence>

      <Sequence from={1740} durationInFrames={20}>
        <Audio src={staticFile('activate.wav')} volume={0.3} />
      </Sequence>

      {/* TODO: Add real TTS audio file at frame ~1430 for AI reply */}
    </AbsoluteFill>
  );
};
