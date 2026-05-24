import { useRef, useEffect, useCallback, useState } from "react";

interface ShaderOrbProps {
  size?: number;
  isActive?: boolean;
  audioLevel?: number;
  className?: string;
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

// Configurable params
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

  // Audio-reactive params
  float noiseIntensity = mix(1.0, 2.0, u_audioLevel);
  float glowIntensity = mix(1.5, 3.0, u_audioLevel);
  float speed = mix(1.0, 2.5, u_active);
  float t = iTime * speed;

  float l = dot(uv, uv);

  float edgeOuter = 1.0 + edgeSoftness;
  float edgeInner = 1.0 - edgeSoftness;
  float sm = smoothstep(edgeOuter, edgeInner, l);

  // Background color based on dark mode
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

  // Audio bounce on rotation
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

  // Audio pulse brightness
  col *= brightness + u_audioLevel * 0.4;

  // Blend with background
  vec3 finalColor = mix(bg, col, sm);
  fragColor = vec4(finalColor, 1.0);
}`;

export function ShaderOrb({ size = 192, isActive = false, audioLevel = 0, className }: ShaderOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(performance.now());
  const uniformsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const smoothAudioRef = useRef(0);
  const smoothActiveRef = useRef(0);
  const darkModeRef = useRef(0);
  const isActiveRef = useRef(isActive);
  const audioLevelRef = useRef(audioLevel);
  const [glReady, setGlReady] = useState(false);

  isActiveRef.current = isActive;
  audioLevelRef.current = audioLevel;

  const initGL = useCallback((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) return null;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("[ShaderOrb] Compile error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return null;

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[ShaderOrb] Link error:", gl.getProgramInfoLog(program));
      return null;
    }

    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    uniformsRef.current = {
      iResolution: gl.getUniformLocation(program, "iResolution"),
      iTime: gl.getUniformLocation(program, "iTime"),
      u_active: gl.getUniformLocation(program, "u_active"),
      u_audioLevel: gl.getUniformLocation(program, "u_audioLevel"),
      u_darkMode: gl.getUniformLocation(program, "u_darkMode"),
    };

    glRef.current = gl;
    programRef.current = program;
    return gl;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const gl = initGL(canvas);
    if (!gl) {
      console.error("[ShaderOrb] WebGL2 initialization failed");
      return;
    }

    setGlReady(true);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniformsRef.current.iResolution!, canvas.width, canvas.height);

    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    darkModeRef.current = darkQuery.matches ? 1 : 0;
    const onDarkChange = (e: MediaQueryListEvent) => { darkModeRef.current = e.matches ? 1 : 0; };
    darkQuery.addEventListener("change", onDarkChange);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let lastFrameTime = performance.now();
    const render = () => {
      const u = uniformsRef.current;
      const now = performance.now();
      const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;
      const elapsed = (now - startTimeRef.current) / 1000;

      const activeRate = 3.0;
      const audioRate = 9.0;
      smoothActiveRef.current += ((isActiveRef.current ? 1 : 0) - smoothActiveRef.current) * (1 - Math.exp(-activeRate * dt));
      smoothAudioRef.current += (audioLevelRef.current - smoothAudioRef.current) * (1 - Math.exp(-audioRate * dt));

      gl.uniform1f(u.iTime!, reducedMotion ? 0 : elapsed);
      gl.uniform1f(u.u_active!, smoothActiveRef.current);
      gl.uniform1f(u.u_audioLevel!, smoothAudioRef.current);
      gl.uniform1f(u.u_darkMode!, darkModeRef.current);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      darkQuery.removeEventListener("change", onDarkChange);
      gl.deleteProgram(programRef.current);
      programRef.current = null;
      glRef.current = null;
    };
  }, [size, initGL]);

  return (
    <div className={className} style={{ width: size, height: size, position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, borderRadius: "50%", display: "block" }}
        aria-hidden="true"
      />
      {!glReady && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: "conic-gradient(from 0deg, oklch(0.75 0.15 350), oklch(0.80 0.12 200), oklch(0.78 0.14 280), oklch(0.75 0.15 350))",
            filter: "blur(8px)",
          }}
        />
      )}
    </div>
  );
}
