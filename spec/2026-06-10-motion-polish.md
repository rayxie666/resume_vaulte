# Spec: 全局过渡动效打磨 ——「排印工坊」的运动语言

- 日期:2026-06-10
- 前置:`spec/2026-06-10-ui-redesign-letterpress.md`(已实装:动效 token
  `--t-fast 140ms / --t-med 220ms / --ease-out(expo)`、modal-rise、
  drawer-rise、sync-pop、bar-rise、编译进度条、卡片 hover 抬升、全局
  `prefers-reduced-motion` 塌缩)
- 目标:为视图切换、内容加载、关键反馈补全过渡动画,让产品"贵"起来——
  但遵守产品工具的运动纪律:**动效只表达状态,不做装饰**;150–250ms;
  transform/opacity 优先;一个 hero 时刻,其余克制。
- 状态:**已实装(2026-06-10)。**

---

## 1. 动效策略(预算分配)

| 层 | 内容 | 预算 |
|---|---|---|
| **Hero 时刻(唯一)** | PDF 编译成功的"落纸"交叉淡入——产品的回报瞬间 | 240ms,精雕 |
| 过渡层 | 视图切换、网格入场、modal 退场、折叠展开 | 180–240ms |
| 反馈层 | 按钮按压、勾选、徽标脉冲、复制确认 | 100–160ms |
| 点缀层 | 齿轮 hover 旋转、恢复高亮 | 极少量,有理由才加 |

通用规则:**退场时长 = 入场 × 0.75**;只用现有 `--ease-out`(expo)一条
曲线保持一致性;禁止 bounce/elastic;不引入动效库,纯 CSS + 极少量 JS
状态管理。

新增 token(App.css `:root`):

```css
--t-view: 200ms;     /* 视图切换 */
--t-hero: 240ms;     /* PDF 落纸 */
--t-exit-med: 160ms; /* --t-med 的退场配套 */
```

## 2. Hero:PDF「落纸」(LatexPreview)

现状:编译成功后 iframe `src` 直接替换,新页瞬间闪现。

规格:**双缓冲交叉淡入**。

- `LatexPreview` 持有两个槽位 `{ current, incoming }`;编译成功 → 新 blob
  URL 进 `incoming`,渲染第二个 iframe(绝对定位叠在 stage 上,
  `opacity: 0`)。
- 新 iframe `onLoad` 触发 → 加 `.settle` 类:
  `opacity 0→1` + `transform: translateY(4px) scale(0.996) → none`,
  `--t-hero` + `--ease-out`——纸张轻轻落上灯桌。
- 动画结束(`animationend` + 200ms 超时兜底)→ 旧 iframe 卸载、revoke 旧
  URL、incoming 升级为 current。
- 期间再次编译完成:丢弃上一个 incoming,直接换最新(永远最多两个 iframe)。
- reduced-motion:全局塌缩已生效,逻辑不依赖 transitionend(用 onLoad +
  timeout),退化为即时替换。
- 失败路径不变(错误抽屉已有 drawer-rise)。

## 3. 过渡层

### 3.1 视图切换(home ↔ category ↔ version ↔ assets)

现状:`.content` 子树瞬间替换,最生硬的一处。

- **方向感知的推/拉**:App 导航处记录方向——进入更深层(home→category→
  version、home→assets)= `push`,返回 = `pop`。
- 实现:视图容器按 `view` 身份加 `key`(强制 remount)+ 类
  `view-enter-push` / `view-enter-pop`:
  - push:`opacity 0→1` + `translateX(12px)→0`
  - pop:`opacity 0→1` + `translateX(-12px)→0`
  - `--t-view` + `--ease-out`,**仅入场**(旧视图直接卸载,不做双视图
    并存的出场编排——成本高、收益小)。
- 导航栏标题随视图变化加同方向 8px 滑入(`.nav-title` 同 key 策略)。

### 3.2 网格入场节奏(分类 / 版本 / 资产网格)

- 卡片入场:`opacity 0→1` + `translateY(8px)→0`,
  `animation-delay: calc(var(--i) * 24ms)`,**封顶 12 张**(`--i` 最大 11,
  之后的卡片统一用最大延迟);总节奏 ≤ 264ms + 180ms。
- `--i` 由 map 渲染时 `style={{ "--i": Math.min(index, 11) }}` 注入。
- 只在视图 remount 时播放(3.1 的 key 策略天然保证);视图内数据刷新
  (改名、计数更新)因 React 按 `key=id` 复用 DOM 不会重播。

### 3.3 缩略图淡入

- `page-thumb img` / `asset-thumb img` 初始 `opacity: 0`,`onLoad` 加
  `.loaded` → `opacity 1`(120ms)。消除缩略图异步解码时的白闪。

### 3.4 Modal / 浮层退场(目前全部瞬间消失)

- 新增共享 hook `useClosing(open, ms)`:`open=false` 时先置 `closing`
  状态、`ms` 后真正卸载;组件加 `data-closing` 属性。
- CSS:`[data-closing] .modal` 播放 modal-rise 的逆向(下沉 6px + 淡出,
  `--t-exit-med`);`[data-closing].modal-backdrop` 背景淡出同步。
- 应用范围:`modal-backdrop/modal`(含 Dialogs、Settings、编辑器弹窗、
  AttachmentsModal)、`select-bar`(下沉退场)、`sync-badge`(success
  自动消失时淡出下沉,error 手动关闭同)。HistoryPanel 全屏 modal 同理。

### 3.5 折叠展开(jd-block、gh-help-details)

- `<details>` 内容瞬开瞬关 → 包一层
  `display:grid; grid-template-rows: 0fr→1fr`(220ms)+ 内层
  `overflow:hidden` 的展开动画(不动 `height`,无 layout 动画违规)。
- summary 的 ▸ 旋转已有(gh-help);jd-block 补同款 marker 旋转。

### 3.6 编译进度与状态胶囊

- 进度条(已有)保持;新增:`preview-state.err` 胶囊出现时
  `scale 0.9→1` + 淡入(140ms),消失时直接移除(错误解除无需仪式)。

## 4. 反馈层(micro-interactions)

| 交互 | 规格 |
|---|---|
| 所有按钮按压 | `:active { transform: scale(0.97) }`,transition 100ms;作用于 `.actions button`、`.modal-actions button`、`.nav-btn`、`.bar-btn`、`.gh-actions button`、`.tile-mini`(transform-only,无重绘) |
| 勾选盘(select-check) | 勾选时 `✓` `scale 0.5→1` 弹出,160ms;选中环(卡片 box-shadow)transition 已有 |
| count-badge 脉冲 | checkpoint / attachment 计数**增加**时播一次 `scale 1→1.22→1`(300ms);实现:React 比较前后值,变化时换 key 触发 animation |
| 复制类按钮(Copy log / 复制文件名) | 点击后文案/图标短暂换为 `✓`,800ms 后还原(无动画库,setTimeout) |
| 输入框 focus | 边框 + 光环 transition 140ms(现为瞬变,补 transition) |
| emoji-pick / color-pick | hover `scale(1.06)` 120ms;选中态瞬时(选择是状态不是表演) |
| 危险按钮 hover | 已有 filter 变化,补 120ms transition 使其不跳变 |

## 5. 点缀层(全部需克制,各一行理由)

- **齿轮图标**:`.icon-btn:hover svg { rotate: 30deg }`(140ms)——提示
  "这里是设置",符合工坊的机械意象。
- **恢复 checkpoint 后**:编辑器内容播一次 600ms 的 `--brand-soft` 背景
  淡出(`.cm-content` 上的一次性类)——回答"刚才发生了什么"。
- **拖拽分栏把手**:hover 时中线加宽已有;补 `cursor: col-resize` 区域内
  把手三点纹理淡入(120ms)——提示可拖拽。
- **明确不做**:空状态漂浮动画、idle 循环动画、彩带/粒子、滚动视差——
  与"安静直到出事"原则冲突。

## 6. 性能与可访问性约束(实装红线)

1. 只动 `transform` / `opacity`(3.5 的 grid-rows 技巧除外,且仅限用户
   触发的展开);**禁止**动画 `width/height/top/left/margin`。
2. `will-change` 仅允许出现在 `.tsx-split.dragging` 的两个 pane 上(拖拽
   期间),其余一律不加。
3. 入场动画一律 `animation-fill-mode: backwards`,避免 delay 期间闪现。
4. 全局 reduced-motion 塌缩规则已存在并继续覆盖全部新增动效;所有 JS
   流程(落纸、useClosing、复制确认)不得依赖动画事件才能完成状态迁移
   ——一律带 timeout 兜底。
5. 动效不阻塞输入:视图切换期间内容立即可点;modal 退场期间 backdrop
   不再拦截点击(pointer-events: none)。
6. 验证:1100×720 默认窗口 + 满网格(30+ 卡片)下 push/pop 与网格入场
   无掉帧(Instruments / FPS HUD 抽查)。

## 7. 实装清单(按文件)

| 文件 | 改动 |
|---|---|
| `src/App.css` | 新 token;view-enter-push/pop、grid 入场、thumb 淡入、退场 keyframes、按压/勾选/脉冲/折叠样式 |
| `src/App.tsx` | 导航方向状态(push/pop);视图容器 key + 类;`--i` 注入;LatexPreview 双缓冲落纸;count-badge 换 key 脉冲;复制确认状态 |
| `src/useClosing.ts`(新) | 退场卸载 hook(~20 行) |
| `src/Dialogs.tsx`、`SettingsModal`、`AttachmentsModal`、`HistoryPanel`、`SelectBar`、`SyncStatus` | 接 `useClosing` + `data-closing` |
| `src/AssetsPanel.tsx`、`useThumbnail` 消费处 | 缩略图 `.loaded` 类 |

预计纯增量 ~250 行 CSS + ~120 行 TS,无新依赖。

## 8. 验收标准

1. **落纸**:连续编辑触发多次编译,每次成功新页 240ms 淡入落定,无白闪、
   无双页残影;编译失败时旧页与错误抽屉行为不变。
2. **视图切换**:home→category→version 前进右滑入、返回左滑入;方向
   永远与导航语义一致;切换期间立即可交互。
3. **网格**:首次进入视图卡片依次浮现(≤ 450ms 全部就位);在视图内
   重命名/删除不重播入场动画。
4. **退场**:所有 modal、select-bar、sync-badge 关闭时有 160ms 退场,
   连按 Esc 快速开关不卡死、不残留 DOM。
5. **反馈**:任意按钮按压有 0.97 缩放;打 checkpoint 后 History 徽标
   脉冲一次;Copy log 点击后显示 ✓。
6. **reduced-motion**:系统开启"减弱动态效果"后,以上全部退化为即时
   切换,功能流程(落纸升级、modal 卸载、复制还原)全部正常完成。
7. 30+ 卡片网格、长文档编辑器下无可感知掉帧;`npm run build` 通过。

## 9. 不做(out of scope)

- 双视图并存的共享元素过渡(FLIP / View Transitions API)——WKWebView
  支持度与收益不匹配,先用单向入场;若后续想要"卡片放大成详情页"的
  无缝过渡,另立 spec 评估 View Transitions API
- 滚动驱动动画、视差
- 主题切换(深↔浅)的全局颜色过渡——全页 transition 引发大面积重绘,
  系统切换本身已有过渡感,明确拒绝
- 动效库(motion / GSAP)——当前需求 CSS 足够,引库再议
