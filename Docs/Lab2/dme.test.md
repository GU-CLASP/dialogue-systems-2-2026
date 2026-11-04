# `sisu/test/dme.test.ts`

这是不打开麦克风也能把对话跑起来的外壳。它和浏览器里的 `isu.ts` 做同一类事：把字符串送进 `dme`，再把 `dme` 吐出的 Move 记成系统台词。

截图里折起来的，就是下面这四块。

## 折叠大纲

```text
dme.test.ts
├─ 1–6      import
├─ 8–11     interface Turn
├─ 13–15    interface TestContext
└─ 17–145   describe("DME tests")
   ├─ 18–106   测试用状态机 machine
   │  ├─ 19–32    setup：演员、记台词的动作、类型
   │  └─ 33–106   createMachine
   │     ├─ 34–38    初始 context
   │     ├─ 42–90    TestInterface 假装用户和扬声器
   │     └─ 91–105   DME 真正启动引擎
   ├─ 108–126  runTest 按轮次播放并核对
   ├─ 128–134  从信念回答
   └─ 136–144  从数据库回答
```

## 1–6 行：导入

```text
从 xstate 拿 setup、createActor、sendTo、assign、waitFor
从 vitest 拿 describe、expect、test
从本项目拿引擎 dme、nlu、nlg、初始信息状态、事件类型
```

测试直接依赖引擎和语言层，不依赖 `isu.ts`，所以不需要 Azure 密钥。

## 8–15 行：两个小类型

```text
Turn = { speaker, message }     一行对话，speaker 是 "sys" 或 "usr"
TestContext = 引擎上下文 + dialogue 数组
```

`dialogue` 是测试自己记的成绩单。引擎的信息状态里没有这个数组。

## 18–32 行：`setup`

```text
演员只有一个：dme
动作 notify(speaker, message):
  把这一行追加到 context.dialogue
事件除了引擎的 SAYS，还有测试专用的 INPUT
```

`INPUT` 是测试作者发明的事件，意思是「用户键盘输入了这句字符串」。引擎不认识 `INPUT`。

## 34–40 行：机器怎么启动

```text
context 一开始:
  dialogue = []
  parentRef = null     真正的父指针在 invoke 时改成这台测试机自己
  is = initialIS()     和浏览器同一份开场状态
initial = "DME"
type = parallel        下面两个区域同时存在
```

并行的意思是：接口一直在听 `INPUT` / `NEXT_MOVES`，引擎同时在跑。谁也不用等对方「进入」自己的状态。

## 42–90 行：`TestInterface`

这是折叠图里最大的一块。它把字符串世界和 Move 世界接上。

```text
收到 INPUT，值为用户字符串:
  立刻 notify，dialogue 加上 { usr, 原句 }
  1000 毫秒后向引擎演员 dmeTestID 发送
    SAYS { speaker: usr, moves: nlu(原句) }

收到 NEXT_MOVES，值为一组 Move:
  1000 毫秒后把同一组 Move 用 SAYS { speaker: sys } 送回引擎
  2000 毫秒后 notify
    dialogue 加上 { sys, nlg(这组 Move) }
```

两处延迟是为了让「先记下用户的话、再等系统开口」在时间上分开。`runTest` 每核对一轮，只等待对话数组变长一条。用户轮在 `INPUT` 时马上变长；系统轮要等 `nlg` 那条延迟动作。

系统台词送回引擎这一步不能省。引擎要靠这句 `SAYS` 把刚问出去的问题压进 `qud`。如果只给用户看文字、不送回引擎，下一轮用户的回答对不上问题。

## 91–105 行：`DME`

```text
invoke 演员 dme，id 为 dmeTestID
启动输入:
  parentRef = 测试机自己
  当前的 latest_moves、latest_speaker、is
```

引擎后来用 `parentRef` 把 `NEXT_MOVES` 送回这台测试机。这和 `isu.ts` 把 `parentRef` 设成语音外壳是同一写法。

## 108–126 行：`runTest`

```text
runTest(预期对话的每一轮):
  启动一台演员
  预期前缀一开始是空
  对每一轮:
    把这一轮放进预期前缀
    如果这一轮是用户:
      发送 INPUT
    等待 dialogue 的长度等于预期前缀的长度
    断言 dialogue 与预期前缀完全一致
    超时 1000 毫秒
```

它不是等整段对话结束再比一次，而是每多一轮就比一次当前前缀。第一轮失败时，后面的轮次不会把错误掩盖掉。

`test.each` 的标题是 `"$speaker> $message"`，所以终端里能看到 `sys> Hello!...` 这种行。

超时写的是 1000 毫秒，而 `NEXT_MOVES` 上记系统台词的动作延迟是 2000 毫秒。现有测试能通过，是因为 Vitest 假计时器会把这些延迟立刻拨完。改测试时如果改成真实时钟，这个 1000 会比 2000 先到期。

## 128–134 行：从信念回答

```text
sys  Hello! You can ask me anything!
usr  What's your favorite food?
sys  Pizza.
```

这组句子锁定三件事：开场白原文、食物问句能被 `nlu` 认出、信念里的 pizza 能被 `nlg` 说成 `Pizza.`。

## 136–144 行：从数据库回答

```text
sys  Hello! You can ask me anything!
usr  Where is the lecture?
sys  Which course?
usr  Dialogue Systems 2
sys  The lecture is in G212.
```

这组句子锁定现在的计划：先问课程，课程代码 `LT2319` 对应教室 `G212`。Lab 2 改「先问星期」时，应从这里复制出新的 `describe`，把预期台词改成新行为，而不是只改旧句子让旧测试继续代表旧行为。
