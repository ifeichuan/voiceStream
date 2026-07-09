import {AbsoluteFill, useCurrentFrame, interpolate} from 'remotion';
import {Placeholder} from '../components/Placeholder';
import {ShimmerSweep} from '../components/remocn/ShimmerSweep';

const TEMPLATES = ['light', 'structured', 'list-friendly', 'tooluse-structured'];
const PROVIDERS = [
  'aliyun-bailian / qwen3.5-flash',
  'anthropic / claude-haiku-4-5',
  'openai / gpt-4o-mini',
  'deepseek / chat',
];
const DICT_WORDS = ['VoiceStream', 'Tauri', 'Pi RPC', 'OKLCH', 'Remotion'];

interface ColumnProps {
  title: string;
  children: React.ReactNode;
}
const Column: React.FC<ColumnProps> = ({title, children}) => (
  <div style={{background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 22px', flex: 1, minHeight: 240}}>
    <div style={{fontSize: 11, color: '#4dc9f6', letterSpacing: 3, textTransform: 'uppercase', fontFamily: 'SF Mono, monospace', marginBottom: 16}}>{title}</div>
    <div style={{display: 'flex', flexDirection: 'column', gap: 7}}>{children}</div>
  </div>
);

interface RowProps {
  label: string;
  active?: boolean;
}
const Row: React.FC<RowProps> = ({label, active}) => (
  <div style={{padding: '10px 14px', borderRadius: 6, background: active ? 'rgba(77, 201, 246, 0.14)' : 'transparent', border: `1px solid ${active ? 'rgba(77, 201, 246, 0.45)' : 'transparent'}`, fontSize: 15, color: active ? '#ffffff' : 'rgba(255,255,255,0.55)', fontFamily: 'SF Mono, monospace'}}>
    {label}
  </div>
);

export const YourWayScene: React.FC = () => {
  const frame = useCurrentFrame();

  const tplIdx = Math.min(TEMPLATES.length - 1, Math.floor(frame / 70));
  const provIdx = Math.min(PROVIDERS.length - 1, Math.floor((frame - 30) / 70));
  const dictRevealCount = Math.max(0, Math.min(DICT_WORDS.length, Math.floor((frame - 40) / 30)));

  const sectionFade = interpolate(frame, [0, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const subtitleFade = interpolate(frame, [220, 260], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0a 70%)',
        justifyContent: 'flex-start',
        alignItems: 'center',
        padding: '60px 80px',
      }}
    >
      <div style={{textAlign: 'center', opacity: sectionFade}}>
        <ShimmerSweep text="YOUR WAY · 设置面板" baseColor="#4dc9f6" shineColor="#ffffff" fontSize={16} fontWeight={500} letterSpacing={4} />
      </div>

      <div style={{marginTop: 30, opacity: sectionFade}}>
        <Placeholder
          label="真实录屏 · 设置面板模板切换"
          hint="录制：模板 / Provider 切换时右侧实时预览同一句话被整理成不同形态"
          duration="约 6s"
          width={1300}
          height={200}
        />
      </div>

      <div style={{marginTop: 28, display: 'flex', gap: 24, width: 1300, opacity: sectionFade}}>
        <Column title="Prompt 模板">
          {TEMPLATES.map((t, i) => <Row key={t} label={t} active={i === tplIdx} />)}
        </Column>
        <Column title="Provider · 模型">
          {PROVIDERS.map((p, i) => <Row key={p} label={p} active={i === provIdx} />)}
        </Column>
        <Column title="自定义词库">
          {DICT_WORDS.slice(0, dictRevealCount).map((w) => <Row key={w} label={w} active />)}
        </Column>
      </div>

      <div style={{position: 'absolute', bottom: 50, left: 0, right: 0, textAlign: 'center', opacity: subtitleFade}}>
        <span style={{fontSize: 24, color: 'rgba(255,255,255,0.88)', fontFamily: '-apple-system, sans-serif', fontWeight: 500, letterSpacing: 3}}>
          你的模板 · 你的模型 · 你的语气
        </span>
      </div>
    </AbsoluteFill>
  );
};
