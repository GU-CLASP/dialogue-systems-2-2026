# `sisu/src/dme.ts`

对话引擎。它不认识英语句子，只按固定顺序尝试 `rules.ts` 里的规则，并在该说话时通知外层。

一条规则在这里被用两次：先问「现在适用吗」，适用才真正改信息状态。

## 折叠大纲

```text
dme.ts
├─ 12–22   isuTransition 把「一条规则」包成一次跳转
├─ 24–66   setup：守卫和动作
│  ├─ 30–36   守卫 isu、latestSpeakerIsUsr
│  └─ 37–65   动作 sendBackNextMoves、isu、updateLatestMoves
└─ 67–158  状态机
   ├─ 73–97    Select 选出要说的话
   └─ 98–156   Update 听一句并改信息状态
```

## 12–22 行：`isuTransition`

```text
isuTransition(下一状态, 规则名):
  跳转条件 = 守卫 isu(规则名) 为真
  跳转动作 = 动作 isu(规则名) 真正改状态
  目标 = 下一状态
```

文件头注释里的第三个参数 `sendBackNextMoves` 没有被使用。真正把话说出去的是 `SelectionDone` 里单独写的动作。

## 30–36 行：两个守卫

```text
isu(规则名):
  调用 rules[规则名](当前上下文)
  规则不适用时返回 undefined，守卫为假
  规则适用时返回一个「还没执行的修改函数」，守卫为真

latestSpeakerIsUsr:
  latest_speaker == "usr"
```

守卫为真只表示「可以改」。真正的修改要等同名动作再把那个函数调用一次。因此规则函数必须没有副作用，调用两次结果一样。现在的规则都符合这一点。

## 37–65 行：三个动作

```text
sendBackNextMoves:
  给 parentRef 发送 { type: NEXT_MOVES, value: is.next_moves }

isu(规则名):
  再取一次规则返回的函数并执行
  用新的 is 替换上下文
  在控制台打印规则名和新状态

updateLatestMoves(SAYS 事件):
  latest_moves = 事件里的 moves
  latest_speaker = 事件里的 speaker
  is.next_moves = 空
```

清空 `next_moves` 是为了下一轮选择从空白列表开始追加，避免把上一轮已经说出去的话又说一遍。

## 73–97 行：Select

Select 里有三个子状态，全部用 `always`：一进来就按顺序试，不用等事件。

```text
SelectAction，按顺序试，中了就去 SelectMove:
  1. select_respond      没计划了，但还有问题，而且信念里有答案
  2. select_from_plan    agenda 空着，plan 里还有下一步
  3. 都不中             仍然去 SelectMove
     打招呼走这条，因为 greet 已经在 agenda 里，不用从 plan 再拿

SelectMove，按顺序试，中了就去 SelectionDone:
  1. select_ask          agenda 顶上是 findout 或 raise，变成一句问话
  2. select_answer       agenda 顶上是 respond，从信念里拿答案
  3. select_other        agenda 顶上是 greet，变成打招呼
  4. 都不中             也去 SelectionDone，这时 next_moves 可能仍是空的

SelectionDone:
  把当前 next_moves 发给外层
  这个子状态结束，Select 整体结束，进入 Update
```

一轮 Select 只会命中一条 SelectMove 规则。想在同一句系统台词里放两个 Move，就要在命中的那一条规则里一次放进 `next_moves`。

## 98–156 行：Update

```text
Init:
  必定执行 clear_agenda，然后去 Grounding

Grounding:
  干等 SAYS
  等到以后:
    updateLatestMoves
    get_latest_move，把最新一句抄进 shared.lu
    去 Integrate

Integrate，按顺序试，中了就去 DowndateQUD:
  integrate_usr_request
  integrate_sys_ask
  integrate_usr_ask
  integrate_answer
  integrate_greet
  都不中也去 DowndateQUD

DowndateQUD，按顺序试:
  downdate_qud    栈顶问题已被 com 解决，弹掉
  find_plan       agenda 顶上是 respond，而且领域里有对应计划
  都不中就去 LoadPlan

LoadPlan:
  没有自己的规则，直接去 ExecPlan

ExecPlan，可以在自己身上多转几次:
  remove_findout   plan 顶上是 findout，而且 com 里已经有答案，删掉这一步
  exec_consultDB   plan 顶上是 consultDB，查库成功就把结果放进 bel，并删掉这一步
  都不中就结束 Update
```

`remove_findout` 和 `exec_consultDB` 的目标仍是 `ExecPlan`。所以同一次 Update 里可以先删掉「问课程」，紧接着再执行「查教室」。

Update 结束后：

```text
如果 latest_speaker 是用户:
  去 Select，轮到系统说话
否则:
  去 Update，系统刚刚说完，继续等下一句
```

因此完整的一问一答在引擎里是：

```text
Select 说出问题
  -> Update 消化「系统刚才问了这个问题」
  -> 再进 Update 等待
  -> 用户的 SAYS 到来
  -> 消化答案、执行计划
  -> 因为说话人是用户，回到 Select
  -> 说出下一句
```

## 和规则文件的分工

`dme.ts` 决定尝试顺序，也决定一条规则成功后去哪。`rules.ts` 只回答「当前信息状态要不要改、改成什么样」。调换 `always` 数组里的先后，系统行为就会变，即使单条规则没动。
