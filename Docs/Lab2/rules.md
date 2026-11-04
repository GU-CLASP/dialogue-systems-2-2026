# `sisu/src/rules.ts`

每条规则都是同一个形状：看当前信息状态，不适用就什么都不返回；适用就返回一个函数，调用后得到新的信息状态。

```text
规则(上下文):
  如果前提不成立:
    return undefined
  return () => 一份改过的 is
```

`dme.ts` 先调用它做守卫，再调用返回的函数做修改。下面按文件里的折叠块解释。规则编号是原作者对照 Larsson 的 IBiS 写下的，编号不连续。

## 折叠大纲

```text
rules.ts
├─ 11–15   Rules 类型
├─ 18–23   clear_agenda
├─ 28–39   get_latest_move
├─ 45–64   integrate_usr_request
├─ 67–82   integrate_sys_ask
├─ 85–108  integrate_usr_ask
├─ 111–130 integrate_answer
├─ 133–141 integrate_greet
├─ 151–164 downdate_qud
├─ 170–192 find_plan
├─ 195–213 remove_findout
├─ 216–237 exec_consultDB
├─ 243–254 select_from_plan
├─ 257–278 select_ask
├─ 281–304 select_respond
├─ 306–322 select_answer
└─ 325–332 select_other
```

## 18–23 行：`clear_agenda`

```text
总是适用
新状态: agenda = []
plan、qud、com、bel 不动
```

每次 Update 一开始就执行。所以上一轮临时放进 agenda 的动作不会留到下一轮。要跨轮次记住「还要问星期」，必须写在 `plan` 里。

## 28–39 行：`get_latest_move`

```text
总是适用
shared.lu = { speaker: latest_speaker, moves: latest_moves }
```

在 `updateLatestMoves` 之后立刻执行，后面的 integrate 规则只读 `lu`，不再读事件本身。

## 45–64 行：`integrate_usr_request`

当前领域没有 `request` 这种说法，`nlu` 也不会产出它。规则留着，现有测试走不到。

```text
如果说话人是用户:
  在这句的 move 里找 type 为 request 的
  在领域计划里找 type 为 action、内容等于这个 request 的
  找到就把那份 plan 接到 agenda 前面
```

## 67–82 行：`integrate_sys_ask`

```text
如果说话人是系统，并且某个 move 是 ask:
  把这个问题插到 qud 最前面
```

这就是「Which course?」说出去之后，问题栈变成 `[课程, 教室]` 的原因。只处理它找到的第一个问句。

## 85–108 行：`integrate_usr_ask`

```text
如果说话人是用户，并且某个 move 是 ask:
  问题插到 qud 最前面
  agenda 最前面放上 { type: respond, content: 这个问题 }
```

用户问「课在哪」或「你喜欢吃什么」都走这里。`respond` 的意思是「这个问题欠一个回答」，还没决定是先追问还是直接答。

## 111–130 行：`integrate_answer`

```text
如果 qud 有栈顶问题:
  在最新一句里找 answer
  并且 relevant(领域, 这个回答, 栈顶问题):
    命题 = combine(...)
    把命题插到 com 最前面
```

短回答在这里才变成命题。不相关的回答这条规则不适用，事实不会进 `com`。

## 133–141 行：`integrate_greet`

```text
如果最新一句里有 greet:
  返回一份内容不变的 is
```

返回函数是为了让守卫通过，从而结束 Integrate 阶段。打招呼不改 qud，也不改 com。

## 151–164 行：`downdate_qud`

```text
q = qud 的栈顶
如果 com 里有某条命题 resolves(命题, q):
  删掉 qud 的第一项
```

用户答完课程后，栈顶从「哪门课」变成下面的「教室在哪」。`com` 为空时循环不进，规则不适用。

## 170–192 行：`find_plan`

```text
如果 agenda 第一项是 respond:
  在领域计划里找 type 为 issue、content 与该问题深度相等的一项
  找到:
    agenda 删掉这第一项
    plan 设成那一项的 plan
```

「课在哪」对得上，`plan` 变成 `[问课程, 查教室]`。「最喜欢的食物」对不上，`plan` 保持空，后面改由信念回答。

它写在 DowndateQUD 阶段，和 `downdate_qud` 同一级，谁先适用谁执行。一次只走一条。

## 195–213 行：`remove_findout`

```text
如果 plan 第一项是 findout:
  这个问题已在 com 里被解决:
    删掉 plan 的第一项
```

问完「哪门课」时，这一步还留在 `plan` 里。等用户答案进了 `com`，这里才把它删掉。用户如果答非所问，这一步还在，下一轮 Select 会再问一次。

`findout` 和 `raise` 的差别就在这里：`select_ask` 对 `raise` 问出口时立刻从 `plan` 删除；`findout` 要等到答案确认才删。

## 216–237 行：`exec_consultDB`

```text
如果 plan 第一项是 consultDB:
  结果 = database.consultDB(这个问题, com)
  如果结果不是 null:
    plan 删掉第一项
    bel 追加这条结果
```

查库结果先进信念，不直接进 `com`，也不直接变成台词。要等后面的 `select_respond` 和 `select_answer` 才说出来。说出去之后，再由下一轮 `integrate_answer` 进入 `com`。

## 243–254 行：`select_from_plan`

```text
如果 agenda 是空的，并且 plan 还有第一项:
  把这第一项复制到 agenda 前面
  plan 本身不删
```

这是把「长期步骤」拿一份到「本轮动作」上。本轮 Update 会清掉 agenda 上的副本。plan 里的原件还在，所以下一步还能再拿。

## 257–278 行：`select_ask`

```text
如果 agenda 第一项是 findout 或 raise:
  造一个 ask Move，追加到 next_moves
  如果 plan 第一项正好是 raise:
    同时把 plan 第一项删掉
  findout 不删 plan
```

现在的领域计划只用 `findout`，所以问「Which course?」不会把这一步从 plan 拿掉。

## 281–304 行：`select_respond`

```text
如果 agenda 空、plan 空、qud 还有问题:
  在 bel 里找一条还没出现在 com 中、而且 relevant 于栈顶问题的信念
  找到就把 { respond, 这个问题 } 放进 agenda
```

三个空条件一起决定时机：计划还没做完时不许用信念抢答。食物问题没有计划，所以信念可以直接用。教室问题要等「问课程、查库」都做完，plan 空了，G212 已经在信念里，这条才适用。

## 306–322 行：`select_answer`

```text
如果 agenda 第一项是 respond:
  在 bel 里找还没进 com、而且 relevant 于这个 respond 所指向问题的信念
  造 answer Move，追加到 next_moves
```

食物和教室的最后一句都是这里产生的。差别只是信念从哪来：食物是初始就有的，教室是查库刚写入的。

## 325–332 行：`select_other`

```text
如果 agenda 第一项是 greet:
  把这个动作本身当作 Move，追加到 next_moves
```

`greet` 的形状碰巧和 Move 一样，所以直接放进去。`nlg` 再把它说成开场白。

## 现有两条对话各自点中哪些规则

食物：

```text
select_other
integrate_greet
integrate_usr_ask
select_respond
select_answer
integrate_answer
downdate_qud
```

教室：

```text
select_other
integrate_greet
integrate_usr_ask
find_plan
select_from_plan
select_ask
integrate_sys_ask
integrate_answer
downdate_qud
remove_findout
exec_consultDB
select_respond
select_answer
```

中间每次 Update 还会经过 `clear_agenda` 和 `get_latest_move`。
