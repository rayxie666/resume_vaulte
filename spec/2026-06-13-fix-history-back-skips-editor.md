# Fix Spec: History 面板按 back 越级返回到分类页(应回到正在编辑的简历)

- 日期:2026-06-13
- 类型:Bug fix(导航 + 堆叠上下文)
- 影响面:编辑器内打开的 HistoryPanel / AttachmentsModal
- 状态:**已实装(2026-06-13)。** §3.1 结构修复:HistoryPanel /
  AttachmentsModal 经 `createPortal(…, document.body)` 渲染,`.modal-backdrop`
  z-index 改 `--z-backdrop`(40),新增 `.dialog-backdrop`(prompt/confirm)
  置 `--z-modal`(50)确保对话框始终压在浮层之上(修了"从 History 里弹
  confirm 会被 History 盖住"的连带回归)。§3.2 语义修复:App 持有
  `editorOverlayCloser` 注册表 + `closeTopOverlay()`/`requestBack()`,navbar
  Back 改走 requestBack,全局 Esc 关最上层浮层(Dialog 打开时让位),
  LatexEditor 用 effect 注册/注销浮层 closer。`npm run build` 通过、应用
  启动无错。完整交互验收(进编辑器→开 History→Back/Esc)需 `npm run
  tauri dev` 真机手测。

---

## 1. 症状

在 version(编辑器)视图打开 **History(checkpoint 历史)面板**后,点击
左上角的 `‹ Back`,**直接回到了 category 视图(该分类下所有简历的网格)**,
而不是关闭 History、回到正在编辑的那份简历。

预期:History 面板 → back → **回到正在编辑的 version 编辑器**(History 只是
编辑器之上的一个浮层,back 应先关浮层)。

## 2. 根因(两个叠加因素)

### 2.1 堆叠上下文陷阱 —— 导航栏盖在了 History 面板之上

`src/App.css`:

```css
.content {            /* <main>,包裹所有视图 */
  position: relative;
  z-index: 2;         /* ← 建立了一个堆叠上下文 */
}
.navbar { z-index: var(--z-nav); }       /* = 10 */
.modal-backdrop { z-index: var(--z-modal); } /* = 50 */
```

- `HistoryPanel` 与 `AttachmentsModal` 在 `LatexEditor` 内渲染,因此它们的
  `.modal-backdrop`(`position: fixed; z-index: 50`)**位于 `.content` 这个
  堆叠上下文内部**(`src/App.tsx:2340 / 2348`,都在 `<main className="content">`
  子树里)。
- 在 `.app` 这一层比较时,`.content`(z-index **2**)整体低于 `.navbar`
  (z-index **10**)。z-index 只在同一堆叠上下文内可比——modal 的 50 只在
  `.content` 内部有意义,**整个 `.content` 子树(含 modal)都被压在 navbar 之下**。
- 结果:打开 History 时,navbar(连同 `‹ Back` 按钮)**画在了 History 面板
  顶部之上**,且可点击。
- 对照:`SettingsModal` 在 App 根级渲染(`src/App.tsx:571`,与 `.content`
  同级),不在 `.content` 上下文内,所以它能正确盖住 navbar——这也解释了
  为什么"设置弹窗正常、History 异常"。
- view-enter 动画给视图容器加的 `transform`(`.view-enter-push/pop`)会**额外**
  制造同样的陷阱(transform 也建立堆叠上下文并成为 fixed 后代的包含块),
  即便去掉 `.content` 的 z-index,动画期间仍会复现。

### 2.2 全局 Back 语义没有"先关浮层"的层级概念

`NavBar` 的 `onBack`(`src/App.tsx:486`)只认 `view.kind`:

```ts
onBack={() => {
  if (view.kind === "version") setView({ kind: "category", categoryId: view.categoryId });
  else if (view.kind === "category" || view.kind === "assets") setView({ kind: "home" });
}}
```

它完全不知道"此刻有一个浮层(History / Attachments / 选择模式)开着"。因此一旦
2.1 让这个按钮变得可点,点击就直接把 version 弹回 category——**越过了"先关
History 回到编辑器"这一层**,正是用户看到的现象。

> 一句话:**navbar 因堆叠陷阱漏到了 modal 之上(2.1),而它的 back 又是
> 无层级的整页返回(2.2),两者叠加 → 越级跳到 category。**

## 3. 修复方案(两层,都做)

### 3.1 结构修复:编辑器内的 modal 用 Portal 渲染到 body

把 `HistoryPanel`、`AttachmentsModal` 的根 `.modal-backdrop` 通过
`createPortal(…, document.body)` 渲染,脱离 `.content` 的堆叠上下文,使其
`z-index: 50` 在 `.app`/`body` 顶层生效、正确盖住 navbar。

- 仅改渲染目标,组件内部 props / 状态 / 关闭逻辑不变(`versionId`、
  `currentContent`、`onRestore`、`onClose` 全部照旧——闭包仍在 LatexEditor
  作用域内)。
- 复用现有 `useModalExit` 退场动画;Portal 不影响 React 事件冒泡(合成事件
  仍按组件树传播)。
- **顺带修正**:`.modal-backdrop` 的 `z-index` 应为 `--z-backdrop`(40)而非
  `--z-modal`(50),与既有刻度注释 `nav<bar<backdrop<modal<toast` 一致;
  `.modal` 自身保持在 backdrop 之上。功能不依赖此项,但纠正语义。
- 原则:**任何带 `.modal-backdrop` 的浮层都应渲染在 `.content` 之外**(根级
  或 Portal)。把这条写进 `DESIGN.md` 的 modal 约定,防止回归。

### 3.2 语义修复:全局 Back / Esc 采用"层级消解"(主修复,直接满足预期)

引入"先关最上层浮层,再返回视图"的统一返回逻辑。定义浮层栈(从上到下):

1. 选择模式(`selectMode`)——已有 `onExitSelect`
2. 编辑器浮层:History(`showHistory`)、Attachments(`showAttachments`)
3. 视图层导航(version→category→home)

实现要点:

- App 持有一个"请求返回"的统一入口 `requestBack()`:按上述顺序,命中第一个
  打开的浮层就**只关它**并 return;都没开才执行原 `onBack` 的视图返回。
- 编辑器浮层状态(`showHistory`/`showAttachments`)目前是 `LatexEditor` 局部
  state,App 不可见。两种接法二选一:
  - **(推荐)状态上提**:把 `showHistory`/`showAttachments` 提到 App,或由
    LatexEditor 通过回调把"当前是否有浮层 + 关闭函数"注册给 App
    (`useImperativeHandle` 或一个 `onOverlayChange(closer|null)` 回调)。
  - 轻量替代:App 维护一个浮层关闭栈(push/pop 注册的 closer),`requestBack`
    弹栈调用。
- `requestBack()` 同时绑定到:navbar `‹ Back`、`Escape` 键(全局,且要让既有
  Dialogs 的局部 Esc 优先——见 §4)、以及 macOS 触控板两指左滑(若后续接入,
  本 spec 不强制)。
- History 面板**自身的 ✕ / 点背景关闭**逻辑不变(它们本就只关浮层,正确)。

> 做完 §3.2 后,即使 §3.1 不做,Back 也会先关 History 回到编辑器——直接满足
> 用户预期。§3.1 仍要做,因为"navbar 视觉上漏在 modal 之上"本身是独立的渲染
> bug(会让 History 顶部被 navbar 遮挡、误触)。

## 4. 边界与回归约束

- **Escape 优先级**:Dialogs(prompt/confirm)的局部 `onKeyDown` Esc 必须仍然
  优先(它在最顶层、且是阻断式确认)。全局 Esc 仅在没有 Dialog 打开时才走
  `requestBack`;实现上 Dialogs 的 Esc 处理里 `stopPropagation` 或全局监听器
  检测 Dialog 开启则跳过。
- **选择模式**:在 category 视图进入选择模式后按 Back,应先退出选择模式
  (已有语义),不可直接回 home——纳入 §3.2 的统一栈,保持现有行为。
- **AttachmentsModal 同源**:它和 History 同在 `.content` 内,§3.1 一并 Portal;
  §3.2 的浮层栈一并覆盖。
- **PullSummary / 编辑弹窗**等根级 modal(已在 `.content` 外)不受影响,但应
  顺手确认其也接入 §3.2 的 Esc 关闭(保持一致),不强制。
- 不得改动 view-enter 动画的观感;§3.1 的 Portal 让动画 transform 不再波及
  modal 定位,反而更稳。

## 5. 验收标准

1. **主场景**:version 编辑器 → 打开 History → 点 `‹ Back` → **回到该 version
   编辑器**(代码、脏标记、滚动位置保留),History 关闭;再点 Back 才回
   category。Attachments 浮层同理。
2. **遮挡修复**:History / Attachments 打开时,navbar **被面板完全盖住**,
   其 `‹ Back` 不可见、不可点;面板顶部内容不被 navbar 压住。
3. **Esc 一致**:History 打开按 Esc = 关闭 History 回编辑器;其上若有
   confirm 对话框,Esc 先关对话框。
4. **选择模式**:category 选择模式按 Back 先退出选择模式,不回 home。
5. **退场动画**:Portal 后 `useModalExit` 退场动画照常播放,无闪烁/无残留 DOM;
   连续快速开关 History 不卡死。
6. **深浅主题 / reduced-motion** 下行为一致。
7. `npm run build` 通过。

## 6. 实装清单(按文件)

| 文件 | 改动 |
|---|---|
| `src/HistoryPanel.tsx` | 根 `.modal-backdrop` 包 `createPortal(…, document.body)` |
| `src/AttachmentsModal.tsx` | 同上 |
| `src/App.tsx` | 浮层栈 / `requestBack()`;navbar `onBack` 改走 `requestBack`;全局 Esc 监听;LatexEditor 注册浮层 closer |
| `src/App.css` | `.modal-backdrop` z-index `--z-modal` → `--z-backdrop`(语义纠正) |
| `DESIGN.md` | 记录"带 backdrop 的浮层必须渲染在 `.content` 之外"的约定 |

预计 ~60 行改动,无新依赖。

## 7. 不做(out of scope)

- 引入真正的浏览器 History / 路由(in-memory view 模型够用,改路由是大重构)
- 触控板两指左滑手势接入(可后续单独评估)
- 把所有 modal 统一抽成一个 `<Modal>` 基础组件(值得做,但属重构,另立 spec)
