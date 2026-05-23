# 迁移方案：react-router-dom → TanStack Router (file-based)

## 动机

- 类型安全的路由参数和 search params
- 文件系统即路由，减少手动配置
- 自动 code-splitting（`autoCodeSplitting`）
- 内置 loader/beforeLoad 生命周期，适合未来数据预取

## 当前架构

```
src/
├── App.tsx          ← 手动渲染所有页面，CSS hidden 控制显隐
├── main.tsx         ← HashRouter + catch-all route
└── pages/
    ├── Overview.tsx
    ├── Agent.tsx    ← 始终挂载，保持 SSE/PTY 连接
    └── Activity.tsx
```

关键约束：Agent 页面必须始终挂载（terminal + SSE 连接不能断）。

## 目标架构

```
src/
├── main.tsx                    ← RouterProvider + createRouter
├── routeTree.gen.ts            ← 自动生成（gitignore）
└── routes/
    ├── __root.tsx              ← 侧边栏 + 全局 layout + Agent 常驻层
    ├── index.tsx               ← Overview
    ├── agent.tsx               ← Agent 路由壳（实际组件在 root 常驻）
    └── activity.tsx            ← Activity
```

## Agent 常驻方案

TanStack Router 没有内置 keep-alive。采用 **root layout 常驻渲染** 模式：

```tsx
// src/routes/__root.tsx
import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
import Agent from '../pages/Agent'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const location = useLocation()
  const isAgent = location.pathname === '/agent'

  return (
    <main className="flex h-screen">
      <Sidebar />
      <div className="flex-1 relative">
        {/* Agent 始终渲染，非激活时 hidden */}
        <div className={isAgent ? 'contents' : 'hidden'}>
          <Agent />
        </div>
        {/* 其他路由正常 mount/unmount */}
        {!isAgent && <Outlet />}
      </div>
    </main>
  )
}
```

这样 Agent 组件永远不会 unmount，SSE/PTY 连接保持。其他页面正常走 file-based routing 的 mount/unmount + code-splitting。

## 迁移步骤

### 1. 安装依赖

```bash
pnpm add @tanstack/react-router
pnpm add -D @tanstack/router-plugin
```

### 2. 配置 Vite 插件

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react(),
  ],
})
```

### 3. 创建路由文件

```tsx
// src/routes/__root.tsx
import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
import { useTauriEvents } from '../hooks/useTauriEvents'
import { Sidebar } from '../components/Sidebar'
import { SettingsDialog } from '../components/SettingsDialog'
import Agent from '../pages/Agent'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  useTauriEvents()
  const location = useLocation()
  const isAgent = location.pathname === '/agent'

  return (
    <main className="flex h-screen min-w-0 bg-paper-surface">
      <Sidebar />
      <ContentWrapper isAgent={isAgent}>
        <div className={isAgent ? 'flex h-full w-full flex-col overflow-hidden px-8' : 'hidden'}>
          <Agent />
        </div>
        {!isAgent && <Outlet />}
      </ContentWrapper>
      <SettingsDialog />
    </main>
  )
}
```

```tsx
// src/routes/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import Overview from '../pages/Overview'

export const Route = createFileRoute('/')({
  component: Overview,
})
```

```tsx
// src/routes/agent.tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/agent')({
  // Agent 实际在 __root.tsx 常驻渲染，这里只是路由占位
  component: () => null,
})
```

```tsx
// src/routes/activity.tsx
import { createFileRoute } from '@tanstack/react-router'
import Activity from '../pages/Activity'

export const Route = createFileRoute('/activity')({
  component: Activity,
})
```

### 4. 更新入口

```tsx
// src/main.tsx
import '@fontsource-variable/geist-mono'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './App.css'

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />
)
```

### 5. 迁移 NavLink

```tsx
// TanStack Router 的 Link 组件
import { Link } from '@tanstack/react-router'

<Link
  to="/"
  className="..."
  activeProps={{ className: 'bg-paper-ink/[0.06] text-paper-ink font-medium' }}
  inactiveProps={{ className: 'text-paper-ink/55' }}
>
```

### 6. 清理

- 删除 `react-router-dom` 依赖
- 删除旧 `App.tsx`（逻辑移入 `__root.tsx` + `Sidebar` 组件）
- `.gitignore` 添加 `src/routeTree.gen.ts`
- `.prettierignore` 添加 `src/routeTree.gen.ts`

## Hash 路由

当前用 `HashRouter`。TanStack Router 支持 hash history：

```tsx
import { createRouter, createHashHistory } from '@tanstack/react-router'

const router = createRouter({
  routeTree,
  history: createHashHistory(),
})
```

## 不变的部分

- 页面组件（Overview、Agent、Activity）内部逻辑不变
- 设置 Dialog 不变（不走路由）
- Zustand stores 不变
- Tauri events hook 不变
- CSS / Tailwind 不变

## 风险

| 风险 | 缓解 |
|------|------|
| Agent 常驻渲染增加初始 bundle | `autoCodeSplitting` 对其他页面生效，Agent 本身已在首屏 |
| routeTree.gen.ts 冲突 | gitignore + dev server 自动重生成 |
| HashRouter 兼容 | TanStack Router 原生支持 `createHashHistory` |
| 类型声明 module augmentation | 按文档添加 `Register` interface |
