# `sisu/src/ui.ts`

页面入口。`index.html` 用这一行把它加载进来：

```html
<script type="module" src="/src/ui.ts"></script>
```

整个文件只做两件事。

## 折叠大纲

```text
ui.ts
├─ 1     从 isu.ts 拿 setupButton
└─ 3–11  画一个按钮，交给语音那一层
```

## 第 1 行

入口接的是 `isu.ts`，不是 `dipper/main.ts`。改「下一句说什么」不用改这个文件。

## 3–11 行

```text
把 #app 换成一个按钮，id 是 counter
找到这个按钮
setupButton(按钮)
```

`setupButton` 负责：点击后发送 `CLICK`，并在听或说的状态变化时改按钮上的字。

id 叫 `counter`，是 Vite 模板留下来的名字。这里没有计数器。

`index.html` 里没有对话内容。网页标题还是 `Vite + TS`。`src/style.css` 只改字体和按钮外观。
