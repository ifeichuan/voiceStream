import {useRef, useEffect, useState} from 'react';
import {useCurrentFrame, useVideoConfig, delayRender, continueRender} from 'remotion';

interface RemotionShaderOrbProps {
  size?: number;
  isActive?: boolean;
  audioLevel?: number;
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 iResolution;
uniform float iTime;
uniform float u_active;
uniform float u_audioLevel;
uniform float u_darkMode;

const vec3 primaryColor = vec3(0.4, 0.6, 1.0);
const vec3 secondaryColor = vec3(0.0, 0.8, 0.8);
const float saturation = 2.0;
const float brightness = 1.0;
const float rotationSpeed = 1.0;
const float noiseScale = 3.0;
const float coreIntensity = 0.5;
const float edgeSoftness = 0.04;

const float TAU = 6.28318530718;

float rand(vec2 n) {
  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 ip = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  float res = mix(
    mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),
    mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x),
    u.y
  );
  return res * res;
}

float fbm(vec2 p, int octaves) {
  float s = 0.0;
  float m = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    s += a * noise(p);
    m += a;
    a *= 0.5;
    p *= 2.0;
  }
  return s / m;
}

vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

void main() {
  float min_res = min(iResolution.x, iResolution.y);
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / min_res * 1.5;

  float noiseIntensity = mix(1.0, 2.0, u_audioLevel);
  float glowIntensity = mix(1.5, 3.0, u_audioLevel);
  float t = iTime;

  float l = dot(uv, uv);

  float edgeOuter = 1.0 + edgeSoftness;
  float edgeInner = 1.0 - edgeSoftness;
  float sm = smoothstep(edgeOuter, edgeInner, l);

  vec3 bg = mix(vec3(1.0), vec3(0.102, 0.09, 0.09), u_darkMode);

  if (sm <= 0.0) {
    fragColor = vec4(bg, 1.0);
    return;
  }

  float d = sm * l * l * l * 2.0;
  vec3 norm = normalize(vec3(uv.x, uv.y, 0.7 - d));

  float nx = fbm(uv * 2.0 * noiseIntensity + t * 0.4 + 25.69, 4);
  float ny = fbm(uv * 2.0 * noiseIntensity + t * 0.4 + 86.31, 4);
  float n = fbm(uv * noiseScale + 2.0 * vec2(nx, ny), 3);

  vec3 col = vec3(n * 0.5 + 0.25);
  float angle = atan(uv.y, uv.x) / TAU + t * 0.1 * rotationSpeed;

  angle += u_audioLevel * sin(t * 6.0) * 0.1;

  vec3 palA = mix(vec3(0.3), primaryColor * 0.5, 0.5);
  vec3 palD = mix(vec3(0.0, 0.8, 0.8), secondaryColor, 0.7);
  col *= pal(angle, palA, vec3(0.5, 0.5, 0.5), vec3(1.0), palD);
  col *= saturation;

  vec3 cd = abs(col);
  vec3 c = col * d;
  c += (c * 0.5 + vec3(1.0) - luma(c)) * vec3(max(0.0, pow(dot(norm, vec3(0.0, 0.0, -1.0)), 5.0) * 3.0));

  float g = glowIntensity * smoothstep(0.6, 1.0, fbm(norm.xy * 3.0 / (1.0 + norm.z), 2)) * d;
  c += g;

  col = c + col * pow((1.0 - smoothstep(1.0, 0.98, l) - pow(max(0.0, length(uv) - 1.0), 0.2)) * 2.0, 4.0);

  float f = fbm(normalize(uv) * 2.0 + t, 2) + 0.1;
  uv *= f + 0.1;
  uv *= 0.5;
  l = dot(uv, uv);

  vec3 ins = normalize(cd) + 0.1;
  float ind = 0.2 + pow(smoothstep(0.0, 1.5, sqrt(l)) * 48.0, 0.25);
  ind *= ind * ind * ind;
  ind = 1.0 / ind;
  ins *= ind;

  col += ins * ins * sm * smoothstep(0.7, 1.0, ind) * coreIntensity * 2.0;
  col += abs(norm) * (1.0 - d) * sm * 0.25;

  col *= brightness + u_audioLevel * 0.4;

  vec3 finalColor = mix(bg, col, sm);
  fragColor = vec4(finalColor, 1.0);
}`;

export const RemotionShaderOrb: React.FC<RemotionShaderOrbProps> = ({
  size = 192,
  isActive = false,
  audioLevel = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const [handle] = useState(() => delayRender('shader-orb-init'));
  const drawnRef = useRef(false);

  const drawFrame = (time: number) => {
    const gl = glRef.current;
    const u = uniformsRef.current;
    if (!gl || !u.iTime) return;
    const speed = 1.0 + (isActive ? 1 : 0) * 3.0;
    gl.uniform1f(u.iTime!, time * speed);
    gl.uniform1f(u.u_active!, isActive ? 1 : 0);
    gl.uniform1f(u.u_audioLevel!, audioLevel);
    gl.uniform1f(u.u_darkMode!, 1.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      continueRender(handle);
      return;
    }

    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 2;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const gl = canvas.getContext('webgl2', {antialias: true, alpha: false, preserveDrawingBuffer: true});
    if (!gl) {
      continueRender(handle);
      return;
    }

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) {
      continueRender(handle);
      return;
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      continueRender(handle);
      return;
    }

    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    uniformsRef.current = {
      iResolution: gl.getUniformLocation(program, 'iResolution'),
      iTime: gl.getUniformLocation(program, 'iTime'),
      u_active: gl.getUniformLocation(program, 'u_active'),
      u_audioLevel: gl.getUniformLocation(program, 'u_audioLevel'),
      u_darkMode: gl.getUniformLocation(program, 'u_darkMode'),
    };

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniformsRef.current.iResolution!, canvas.width, canvas.height);

    glRef.current = gl;
    programRef.current = program;

    // Synchronous first draw before continuing render
    const time = frame / fps;
    drawFrame(time);
    gl.finish();
    drawnRef.current = true;
    continueRender(handle);

    return () => {
      gl.deleteProgram(program);
      glRef.current = null;
      programRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  useEffect(() => {
    if (!drawnRef.current) return;
    const time = frame / fps;
    drawFrame(time);
  }, [frame, fps, isActive, audioLevel]);

  return (
    <canvas
      ref={canvasRef}
      style={{width: size, height: size, borderRadius: '50%', display: 'block'}}
    />
  );
};
