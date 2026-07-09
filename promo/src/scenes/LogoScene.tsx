import {AbsoluteFill, Sequence} from 'remotion';
import {SpringPopIn} from '../components/remocn/SpringPopIn';
import {BlurReveal} from '../components/remocn/BlurReveal';

export const LogoScene: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(ellipse at center, #0a0a14 0%, #050505 70%)',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div style={{marginTop: 270, textAlign: 'center'}}>
        <SpringPopIn damping={14} stiffness={120} mass={0.9}>
          <h1
            style={{
              margin: 0,
              fontSize: 72,
              fontWeight: 700,
              color: '#ffffff',
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              letterSpacing: -2,
            }}
          >
            SpeakMore
          </h1>
        </SpringPopIn>
        <Sequence from={12} durationInFrames={48} layout="none">
          <BlurReveal
            text="voice in. work out."
            revealFrames={20}
            blur={6}
            fontSize={18}
            color="rgba(255,255,255,0.5)"
            fontFamily="SF Mono, Menlo, monospace"
            style={{letterSpacing: 4}}
          />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};
