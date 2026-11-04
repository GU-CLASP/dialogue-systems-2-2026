# `sisu/test/dme.test.ts`

这是不用麦克风也能把对话跑起来的外壳。它和浏览器里的 `isu.ts` 干同一类活：把英文字符串送进 `dme`，再把 `dme` 吐出来的 `move` 记成系统台词。

截图里折起来的，就是下面这几块。

## 折叠大纲

```text
dme.test.ts
├─ 1–6      import
├─ 8–11     interface Turn 对话里的一行
├─ 13–15    interface TestContext
└─ 17–145   describe("DME tests")
   ├─ 18–106   测试用的状态机
   │  ├─ 19–32    准备：谁来跑，怎么记台词
   │  └─ 33–106   造出这台机器
   │     ├─ 34–38    一开始记着什么
   │     ├─ 42–90    TestInterface 假装用户和喇叭
   │     └─ 91–105   真正启动 dme
   ├─ 108–126  runTest 一轮一轮对答案
   ├─ 128–134  用 bel 里的事实回答
   └─ 136–144  查表回答
```

## 1–6 行：拿进来什么

```text
从 xstate 拿 setup、createActor、sendTo、assign、waitFor
从 vitest 拿 describe、expect、test
从本项目拿 dme、nlu、nlg、开场记录、事件类型
```

测试直接用 `dme` 和 `nlug`，不经过 `isu.ts`，所以不用 Azure 密钥。

## 8–15 行：一行对话长什么样

```text
Turn = { speaker, message }
  speaker 是 "sys" 或 "usr"
  message 是人能读的英文

TestContext = dme 的记录 + 一个 dialogue 数组
```

`dialogue` 是测试自己的成绩单。`dme` 的 `InformationState` 里没有这个数组。

## 18–32 行：准备

```text
跑起来的程序只有一个：dme

动作 notify(speaker, message):
  把这一行追加到 context.dialogue

事件除了 dme 认识的 SAYS，还有测试自己发明的 INPUT
```

`INPUT` 的意思是「用户键盘输入了这句英文」。`dme` 不认识 `INPUT`。

## 34–40 行：一开始的状态

```text
dialogue = []
parentRef = null
  真正的父指针要等 dme 启动时，改成这台测试机自己
is = initialIS()
  和浏览器用的是同一份开场记录

两个区域同时存在：TestInterface 和 DME
```

同时存在的意思是：接口一直听 `INPUT` 和 `NEXT_MOVES`，`dme` 也一直在跑。谁也不用等对方先「进入」自己的状态。

## 42–90 行：`TestInterface`

这是折叠图里最大的一块。它把英文和 `move` 接上。

```text
收到 INPUT，值是用户原句:
  马上记一行 { usr, 原句 }
  过 1000 毫秒，向 dme 发送
    SAYS { speaker: usr, moves: nlu(原句) }

收到 NEXT_MOVES，值是一组 move:
  过 1000 毫秒，把同一组 move 送回 dme
    SAYS { speaker: sys, moves: 这组 move }
  过 2000 毫秒，记一行
    { sys, nlg(这组 move) }
```

延迟是为了把「先记下用户的话」和「再等系统开口」分开。`runTest` 每核对一轮，只等成绩单多出一行。用户那行在 `INPUT` 时马上多出来。系统那行要等 `nlg` 的延迟动作。

系统的 `move` 必须送回 `dme`。`dme` 靠这句 `SAYS` 才知道自己刚刚问过什么，并把问题压进 `qud`。如果只把英文显示给用户、不送回去，下一轮用户的回答就对不上问题。

## 91–105 行：启动 `dme`

```text
启动 dme，名字叫 dmeTestID
交给它:
  parentRef = 测试机自己
  当时的 latest_moves、latest_speaker、is
```

`dme` 后来用 `parentRef` 把 `NEXT_MOVES` 送回这台测试机。`isu.ts` 把 `parentRef` 设成语音那层，写法一样。

## 108–126 行：`runTest`

```text
runTest(预期的每一轮):
  启动
  已经核对过的前缀，一开始是空的
  对每一轮:
    把这一轮放进前缀
    如果这一轮是用户，发送 INPUT
    等到 dialogue 的行数等于前缀的行数
    断言 dialogue 和前缀一模一样
    最多等 1000 毫秒
```

它不是等整段说完再比一次，而是多一轮就比一次当前前缀。第一轮错了，后面不会把错误盖住。

测试标题是 `"$speaker> $message"`，所以终端里能看到 `sys> Hello!...` 这种行。

超时写的是 1000 毫秒，而记下系统台词的动作延迟是 2000 毫秒。现有测试能过，是因为 Vitest 会把这些延迟立刻拨完。如果改成真实时钟，1000 会比 2000 先到。

## 128–134 行：用 `bel` 回答

```text
sys  Hello! You can ask me anything!
usr  What's your favorite food?
sys  Pizza.
```

这三行钉死三件事：开场白的原文、食物问句能被 `nlu` 认出来、`bel` 里的 pizza 能被说成 `Pizza.`。

## 136–144 行：查表回答

```text
sys  Hello! You can ask me anything!
usr  Where is the lecture?
sys  Which course?
usr  Dialogue Systems 2
sys  The lecture is in G212.
```

这五行钉死现在的计划：先问课程，课程代码 `LT2319` 对应教室 `G212`。Lab 2 要改成「先问星期」时，应复制出一个新的 `describe`，把预期台词写成新行为。不要只改这几句旧台词，让旧测试偷偷变成新测试。
