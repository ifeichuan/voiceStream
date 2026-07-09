# ShaderOrb：一个会流动的球是怎么画出来的

> 面向纯小白的源码解读：`src/components/ShaderOrb.tsx` 用 200 多行做了什么。

## 这个组件长什么样

一颗会随时间慢慢变形流动、随麦克风音量脉动、被鼠标"磁吸"、点击会爆一下、折叠时缩成小球的彩色发光球体。

它由两部分组成：

- **GPU 部分**：用 WebGL 在 canvas 里画球体本身（颜色、纹理、光晕全部实时计算）
- **React 部分**：挂载 canvas、每帧把数据"喂"给 GPU、处理鼠标交互和缩放动画

## 为什么必须用 shader

球体上每一个像素的颜色都不同，并且每一帧都在变。

CSS 一次只能控制一个 div 的整体样式（颜色、渐变、滤镜），无法做到"每个像素独立计算"。如果你想要"流动的云雾纹理 + 边缘光晕 + 中心亮核"这种效果，普通 div + CSS 永远做不到——必须把任务交给 GPU。

WebGL 是浏览器提供的一个接口，让 JavaScript 调用 GPU。`canvas` 是画布，shader 是跑在 GPU 上的小程序。GPU 擅长**对很多像素并行做同样的计算**——一个 200×200 的球需要 4 万个像素同时上色，CPU 一个一个算根本来不及。

## 两个 shader 分别在干什么

GPU 画图永远是两步走：先确定形状的顶点位置，再给形状内每个像素涂颜色。

### Vertex shader（顶点着色器）

`ShaderOrb.tsx:15-19` 定义的 `VERTEX_SHADER` 极简，就是把传进来的 4 个点位置原样输出。

这 4 个点在 `ShaderOrb.tsx:282` 上传到 GPU：`(-1,-1)`, `(1,-1)`, `(-1,1)`, `(1,1)`——也就是画布的四个角，组成一个铺满整个画布的矩形。

```glsl
#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
```

它的工作就是告诉 GPU："请把要画的区域覆盖整个画布"。整个组件的"形状"工作到这就结束了——剩下的事全靠片段 shader。

### Fragment shader（片段着色器）

`ShaderOrb.tsx:21-153` 这一大段才是球体效果的真正来源。

GPU 会对画布内**每一个像素**都跑一遍这段代码，每跑一次输出一个 `fragColor`（这个像素的最终颜色）。一个 200×200 的球，就是 4 万次独立计算，并行跑在 GPU 上。

我们接下来一步步拆解 fragment shader 的 `main()` 函数。

## 片段 shader 步步拆解

GLSL（OpenGL Shading Language，shader 用的语言）跟 JavaScript 不太一样：

- 类型严格：`vec2` 是 2 维向量，`vec3` 是 3 维（常用来存 RGB），`float` 是浮点数
- 取分量不用下标 `[0]`，而是 `.x`、`.y`、`.z` 或 `.r`、`.g`、`.b`（同样的东西不同的写法）
- 内建函数都跟数学有关：`dot`（点积）、`mix`（线性插值）、`smoothstep`（平滑过渡）

读不懂语法没关系，跟着每一步在干什么走就行。

### Step 1: 把像素坐标变成"以中心为原点"的坐标

`ShaderOrb.tsx:83-85`：

```glsl
float min_res = min(iResolution.x, iResolution.y);
vec2 fragCoord = gl_FragCoord.xy;
vec2 uv = (fragCoord * 2.0 - iResolution.xy) / min_res * 1.5;
```

`gl_FragCoord.xy` 是当前像素在画布上的位置（比如 `(100, 80)`，从左下角开始数）。这一步把它变换成 `-1.5 ~ +1.5` 的范围，原点 `(0,0)` 在画布正中心。

为什么要做这一步？后面所有计算都跟"离中心多远"挂钩——画一个圆形的球体，最自然的就是用以中心为原点的坐标系。

### Step 2: 判断当前像素在不在球内

`ShaderOrb.tsx:92-104`：

```glsl
float l = dot(uv, uv);
float sm = smoothstep(1.0 + edgeSoftness, 1.0 - edgeSoftness, l);
```

`dot(uv, uv)` 等价于 `uv.x * uv.x + uv.y * uv.y`，也就是**当前点离中心距离的平方**。

`smoothstep(a, b, x)` 是 GLSL 内建函数：当 `x` 接近 `a` 时返回 0，接近 `b` 时返回 1，中间是平滑的 S 曲线。

所以 `sm` 这个变量的含义是"我有多属于这个球"：

- `sm = 0`：完全在球外
- `sm = 1`：完全在球内
- `0 < sm < 1`：在边界过渡区（这就是为什么球的边缘是软的，不是硬切边）

下面紧跟一行 `if (sm <= 0.0) { fragColor = vec4(bg, 1.0); return; }` 直接把球外的像素涂成背景色，省掉后面的复杂计算——shader 优化的常见手法叫 **early exit**。

### Step 3: 生成"流动"的纹理

`ShaderOrb.tsx:109-111`：

```glsl
float nx = fbm(uv * 2.0 * noiseIntensity + t * 0.4 + 25.69, 4);
float ny = fbm(uv * 2.0 * noiseIntensity + t * 0.4 + 86.31, 4);
float n = fbm(uv * noiseScale + 2.0 * vec2(nx, ny), 3);
```

这一段调了三次 `fbm()` 函数，最后得到一个"看起来像流动云雾"的灰度值 `n`。

要看懂这一步，需要先理解三个东西：**噪声**、**FBM**、**域扭曲**。

#### 噪声（noise）

`ShaderOrb.tsx:48-58` 实现的 `noise()` 函数是一个**伪随机但平滑的函数**：输入一对坐标，输出 0~1 的一个值。同样的输入永远得到同样的输出，但相邻的输入得到接近的输出。

如果直接画 `noise(uv)`，看起来就像电视雪花点稍微模糊一下——一片有起伏的灰色噪点。

#### FBM（Fractional Brownian Motion，分形布朗运动）

`ShaderOrb.tsx:60-72` 实现的 `fbm()` 函数把 noise 在不同尺度上叠 4 层：

- 第 1 层：大尺度，权重 0.5（粗略起伏）
- 第 2 层：尺度 ×2，权重 0.25（中等细节）
- 第 3 层：尺度 ×4，权重 0.125（细节）
- 第 4 层：尺度 ×8，权重 0.0625（毛刺感）

加起来效果就是云雾、火焰、流体那种**有大有小、自相似的自然不规则纹理**——大自然里风吹云、水流、岩石纹理都是分形的，所以 fbm 看起来"像真的"。

#### 域扭曲（domain warping）

注意 `n = fbm(uv * noiseScale + 2.0 * vec2(nx, ny), 3)` 这一行——传给 fbm 的坐标 `uv` 不是直接用，而是**先用另两份 fbm（`nx`、`ny`）扭一下**。

直白说：第一组 fbm 决定"该往哪儿采样"，第二组 fbm 在这个被扭曲过的坐标上采样。结果就是流动感更强的纹理，像液体、火焰、烟。

#### 时间项 `+ t * 0.4`

`t` 是当前时间（`iTime` uniform）。每一帧 `t` 都不一样，所以 fbm 的采样位置一直在飘——这就是为什么你看到的纹理在"流动"。

### Step 4: 上色

`ShaderOrb.tsx:114-122`：

```glsl
vec3 col = vec3(n * 0.5 + 0.25);
float angle = atan(uv.y, uv.x) / TAU + t * 0.1 * rotationSpeed;
angle += u_audioLevel * sin(t * 6.0) * 0.1;

vec3 palA = mix(vec3(0.3), primaryColor * 0.5, 0.5);
vec3 palD = mix(vec3(0.0, 0.8, 0.8), secondaryColor, 0.7);
col *= pal(angle, palA, vec3(0.5, 0.5, 0.5), vec3(1.0), palD);
col *= saturation;
```

第一行 `col = vec3(n * 0.5 + 0.25)` 把噪声 `n` 映射到 `[0.25, 0.75]` 的灰度作为基础亮度。

`atan(uv.y, uv.x)` 是反正切函数——给一个二维向量，返回它跟 x 轴的夹角（弧度）。`/ TAU` 把 `[-π, π]` 映射到 `[-0.5, 0.5]`。所以 `angle` 表示**当前像素相对中心的方位角**，再加上时间项让它慢慢转。

`pal()` 函数在 `ShaderOrb.tsx:74-76`：

```glsl
vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}
```

这是 Inigo Quilez（shader 大神）发明的**余弦调色盘**，shader 圈子的经典技巧。给一个数字 `t`，返回一个颜色。原理：用三个错开相位的余弦波分别作为 R、G、B 通道，得到周期循环的色彩。

把 `angle` 当作 `t` 传进去，意味着**球体的颜色按方位角循环**——绕一圈走完整个色谱。再叠上 `+ t * 0.1` 的时间项，整个色谱在缓慢旋转。

### Step 5: 加立体感（高光、辉光、内核）

`ShaderOrb.tsx:124-145` 是最玄学的部分，但本质就是几个经验公式叠加：

- `norm = normalize(vec3(uv.x, uv.y, 0.7 - d))` 是一个**伪造的"球面法向量"**，假装 uv 是球面投影，用它和虚拟光线方向做点积模拟高光
- 第二段 `fbm` 在球的外缘加颗粒辉光
- `ins * ind * sm` 在球的核心位置加亮，让中心有"发光内核"

这种"堆几个公式，调几个系数，看起来对就行"的写法是 shader 创作的常态。Shadertoy 上很多大神的代码都是这样——他们也不是用严格物理推导出来的，而是凑数 + 审美。

### Step 6: 音频反应

shader 里有三处用到 `u_audioLevel`：

- `ShaderOrb.tsx:88-89`：噪声强度和辉光强度随音量变大
- `ShaderOrb.tsx:117`：旋转角加上 `sin(t*6.0)` 的抖动（声音越大球晃越快）
- `ShaderOrb.tsx:148`：整体亮度提升

所以你说话越大声，球越炸。

## React 是怎么把它串起来的

shader 自己不会动。React 部分负责"喂"它数据，分三块。

### 初始化（一次性）

`ShaderOrb.tsx:248-299` 的 `initGL` 函数干 5 件事：

1. 拿到 WebGL2 上下文
2. 编译两段 shader 字符串，得到两个 shader 对象
3. 把它们 link 成一个完整的 program
4. 把 4 个顶点上传到 GPU 的 buffer 里
5. 记下所有 uniform 的位置（后面要用）

**uniform** 是 CPU 和 GPU 之间的传值通道。你在 JS 里 `gl.uniform1f(loc, value)`，shader 那边 `uniform float u_xxx` 就能拿到对应的值。

整个组件用了 5 个 uniform：

| Uniform | 类型 | 含义 |
|---|---|---|
| `iResolution` | `vec2` | 画布像素尺寸 |
| `iTime` | `float` | 累计动画时间 |
| `u_active` | `float` | 是否激活（0~1，平滑过渡） |
| `u_audioLevel` | `float` | 音频电平 |
| `u_darkMode` | `float` | 是否深色模式 |

### 每帧渲染循环

`ShaderOrb.tsx:328-357` 的 `render` 函数大致流程：

```
requestAnimationFrame → 算 dt（距上一帧的秒数）
                    → 平滑插值 active/audio
                    → 累加 shaderTime（dt × 速度系数）
                    → 把数值塞进 uniforms
                    → drawArrays 触发 GPU 绘制
                    → 递归调用自己（下一帧）
```

`smoothActiveRef`、`smoothAudioRef`（`ShaderOrb.tsx:343-344`）用**指数平滑**让数值变化是渐入渐出的：

```
smoothActive += (target - smoothActive) * (1 - exp(-rate * dt))
```

为什么不直接 `isActive ? 1 : 0`？因为那样球会瞬间炸开/瞬间熄灭，视觉太突兀。指数平滑给了一种"惯性"。

### 交互层（用 motion/react）

- **磁吸**（`ShaderOrb.tsx:213-246`）：监听 document 的 `pointermove`，鼠标进入半径范围就让球往鼠标方向偏一点。`useSpring` 让位移有弹簧手感。
- **点击爆发**（`ShaderOrb.tsx:203-211`）：把 `boostSpring` 弹到一个随机强度，600ms 后回到 0；这个 boost 同时影响 `smoothActive` 和 `smoothAudio`，所以视觉上是"爆一下"。
- **折叠缩放**（`ShaderOrb.tsx:393-397`）：`collapsed` 改变时 `scale` 在 1 和 0.25 之间切，spring 配置让它弹一下。

## 几个值得记住的小技巧

1. **浮点数控制视觉变化**：`u_active` 不是布尔（true/false）而是 0~1 的浮点，配合平滑可以做软切换
2. **uniform 是单向通道**：CPU → GPU，shader 不能往回写——所有交互逻辑必须在 JS 层完成
3. **shader 里没有调试器**：写 GLSL 想调试只能"画出来看"，常见手法是 `fragColor = vec4(value, 0, 0, 1)` 把要看的数值映射成红色亮度
4. **`devicePixelRatio` 不能漏**：`ShaderOrb.tsx:305-307` 把 canvas 实际像素乘以 dpr，否则在 retina 屏上会模糊
5. **`prefers-reduced-motion`**：`ShaderOrb.tsx:324, 350` 检测系统的"减少动效"开关，开启时 `iTime` 固定为 0——可访问性细节
6. **用 ref 不用 state**：`isActive`、`audioLevel` 用 `useRef` 而不是 `useState`，避免每次值变都触发 React 重渲染。`render` 函数从 ref 读，是无 React 渲染开销的高频更新

## 一句话总结

**Shader 的本质就是：写一个数学公式，让 GPU 对每个像素都算一遍输出颜色。**

球体感来自距离判定 + 噪声纹理 + 调色盘 + 假光照，全部都是数学。React 这层只负责"开机"和"喂参数"。

## 想入门 shader

- [The Book of Shaders](https://thebookofshaders.com/)：最好的入门教程，互动可改
- [Shadertoy](https://www.shadertoy.com/)：看别人写的特效，直接抄改
- [Inigo Quilez 的文章](https://iquilezles.org/articles/)：noise、FBM、SDF、调色盘等核心技巧的源头

`ShaderOrb` 这个组件的写法就是典型的 Shadertoy 风格——把那边的代码搬到 React + WebGL2 里，再用 motion/react 加交互层。

