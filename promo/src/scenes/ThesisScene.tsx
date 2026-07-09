import {AbsoluteFill, Sequence} from 'remotion';
import {BlurReveal} from '../components/remocn/BlurReveal';

const LINES = [
  {text: '先是输入法',           startFrame: 20,  emphasis: false},
  {text: '然后是 Agent 入口',    startFrame: 70,  emphasis: false},
  {text: '说一句。它跑。它讲。', startFrame: 120, emphasis: true},
];

export const ThesisScene: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(ellipse at center, #0a0a14 0%, #050505 70%)',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div style={{display: 'flex', flexDirection: 'column', gap: 22, textAlign: 'center', marginTop: 220}}>
        {LINES.map((line, i) => (
          <Sequence key={i} from={line.startFrame} durationInFrames={180 - line.startFrame} layout="none">
            <BlurReveal
              text={line.text}
              revealFrames={24}
              blur={8}
              fontSize={line.emphasis ? 48 : 32}
              color={line.emphasis ? '#ffffff' : 'rgba(255,255,255,0.78)'}
              fontWeight={line.emphasis ? 600 : 400}
              fontFamily={line.emphasis ? 'SF Mono, Menlo, monospace' : '-apple-system, BlinkMacSystemFont, sans-serif'}
            />
          </Sequence>
        ))}
      </div>
    </AbsoluteFill>
  );
};
