import {AbsoluteFill, Sequence, Audio, staticFile} from 'remotion';
import {OpeningScene} from './scenes/OpeningScene';
import {DictationScene} from './scenes/DictationScene';
import {DictationScene2} from './scenes/DictationScene2';
import {DictationScene3} from './scenes/DictationScene3';
import {AgentScene} from './scenes/AgentScene';
import {ClosingScene} from './scenes/ClosingScene';

export const Promo: React.FC = () => {
  return (
    <AbsoluteFill style={{backgroundColor: '#0a0a0a'}}>
      {/* Scenes */}
      <Sequence from={0} durationInFrames={120}>
        <OpeningScene />
      </Sequence>
      <Sequence from={120} durationInFrames={130}>
        <DictationScene />
      </Sequence>
      <Sequence from={250} durationInFrames={130}>
        <DictationScene2 />
      </Sequence>
      <Sequence from={380} durationInFrames={130}>
        <DictationScene3 />
      </Sequence>
      <Sequence from={510} durationInFrames={190}>
        <AgentScene />
      </Sequence>
      <Sequence from={700} durationInFrames={90}>
        <ClosingScene />
      </Sequence>

      {/* Sound effects */}
      {/* Opening - activate */}
      <Sequence from={5} durationInFrames={15}>
        <Audio src={staticFile('activate.wav')} volume={0.6} />
      </Sequence>

      {/* Dictation 1 - keystroke + record start */}
      <Sequence from={128} durationInFrames={10}>
        <Audio src={staticFile('keystroke.wav')} volume={0.8} />
      </Sequence>
      <Sequence from={130} durationInFrames={15}>
        <Audio src={staticFile('record-start.wav')} volume={0.5} />
      </Sequence>

      {/* Dictation 2 - keystroke + record start */}
      <Sequence from={258} durationInFrames={10}>
        <Audio src={staticFile('keystroke.wav')} volume={0.8} />
      </Sequence>
      <Sequence from={260} durationInFrames={15}>
        <Audio src={staticFile('record-start.wav')} volume={0.5} />
      </Sequence>

      {/* Dictation 3 - keystroke + record start */}
      <Sequence from={388} durationInFrames={10}>
        <Audio src={staticFile('keystroke.wav')} volume={0.8} />
      </Sequence>
      <Sequence from={390} durationInFrames={15}>
        <Audio src={staticFile('record-start.wav')} volume={0.5} />
      </Sequence>

      {/* Agent - keystroke + activate */}
      <Sequence from={518} durationInFrames={10}>
        <Audio src={staticFile('keystroke.wav')} volume={0.8} />
      </Sequence>
      <Sequence from={520} durationInFrames={15}>
        <Audio src={staticFile('activate.wav')} volume={0.5} />
      </Sequence>

      {/* Agent - question sound */}
      <Sequence from={620} durationInFrames={20}>
        <Audio src={staticFile('question.wav')} volume={0.6} />
      </Sequence>

      {/* Agent - second keystroke for voice reply */}
      <Sequence from={640} durationInFrames={10}>
        <Audio src={staticFile('keystroke.wav')} volume={0.7} />
      </Sequence>
      <Sequence from={642} durationInFrames={15}>
        <Audio src={staticFile('record-start.wav')} volume={0.5} />
      </Sequence>

      {/* Agent - complete */}
      <Sequence from={675} durationInFrames={30}>
        <Audio src={staticFile('complete.wav')} volume={0.6} />
      </Sequence>

      {/* Closing - activate */}
      <Sequence from={700} durationInFrames={15}>
        <Audio src={staticFile('activate.wav')} volume={0.4} />
      </Sequence>
    </AbsoluteFill>
  );
};
