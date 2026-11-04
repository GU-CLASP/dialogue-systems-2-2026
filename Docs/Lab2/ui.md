# `sisu/src/ui.ts`

页面入口。`index.html` 用 `<script type="module" src="/src/ui.ts">` 加载它。整个文件只做两件事。

## 折叠大纲

```text
ui.ts
├─ 1     从 isu.ts 引入 setupButton
└─ 3–11  画一个按钮并交给语音外壳
```

## 1 行

入口接的是 `isu.ts`，不是 `dipper/main.ts`。改对话策略不需要改这个文件。

## 3–11 行

```text
把 #app 的内容换成一个按钮 #counter
找到这个按钮
setupButton(按钮)
```

`setupButton` 负责点击后发送 `CLICK`，并在识别或朗读状态变化时改按钮上的字。按钮的 id 叫 `counter`，是 Vite 模板留下来的名字，这里并没有计数器。

`index.html` 本身没有对话标记。标题仍是 `Vite + TS`。样式在 `src/style.css`，只影响字体和按钮外观。
