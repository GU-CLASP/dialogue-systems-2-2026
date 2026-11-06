# `sisu/src/rules.ts`

每条规则都是同一个形状：看看当前记录，用不上就什么都不返回；用得上就返回一个函数，调用之后得到一份新记录。

```text
规则(当前记录):
  如果前提不成立:
    return undefined
  return () => 一份改过的 is
```

`dme.ts` 先调用它，看用不用得上；再用返回的函数去改。下面按文件里折起来的块来说。规则编号是原作者对照 Larsson 的 IBiS 写下的，编号不连续，跳号不用管。

## 折叠大纲

```text
rules.ts
├─ 11–15   规则的类型
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
总是用得上
新记录: agenda = []
plan、qud、com、bel 不动
```

每次 Update 一开始就做。上一轮临时放进 `agenda` 的动作不会留到下一轮。要跨轮次记住「还要问星期几」，必须写在 `plan` 里。

## 28–39 行：`get_latest_move`

```text
总是用得上
shared.lu = { 谁说的, 哪些 move }
```

它紧跟在「记下刚听到的话」后面。再往后的规则只读 `lu`，不再读事件本身。

## 45–64 行：`integrate_usr_request`

现在的 `domain` 没有请求，`nlu` 也不会做出这种 `move`。规则留着，现有测试走不到。

```text
如果说话的是用户:
  在这句 move 里找 type 为 request 的
  在 domain 的计划里找 type 为 action、内容对得上的
  找到就把那份 plan 接到 agenda 前面
```

## 67–82 行：`integrate_sys_ask`

```text
如果说话的是系统，并且某个 move 是 ask:
  把这个问题插到 qud 最前面
```

这就是系统说完 “Which course?” 之后，问题列表变成 `[课程, 教室]` 的原因。它只处理找到的第一个问句。

## 85–108 行：`integrate_usr_ask`

```text
如果说话的是用户，并且某个 move 是 ask:
  问题插到 qud 最前面
  agenda 最前面放上 { type: respond, content: 这个问题 }
```

用户问「课在哪」或「你喜欢吃什么」，都走这里。`respond` 的意思是「这个问题还欠一个回答」，还没决定是先追问还是直接答。

## 111–130 行：`integrate_answer`

```text
如果 qud 最上面有问题:
  在最新一句里找 answer
  并且 relevant 说这个回答和那个问题搭:
    把 combine 做出来的事实插到 com 最前面
```

短回答在这里才变成一条事实。不搭的回答，这条规则用不上，什么都不会写进 `com`。

## 133–141 行：`integrate_greet`

```text
如果最新一句里有 greet:
  返回一份内容没变的 is
```

返回一个函数，是为了让 `dme` 知道「这条用得上」，从而结束「并进记录」这一步。打招呼不改 `qud`，也不改 `com`。

## 151–164 行：`downdate_qud`

```text
q = qud 最上面的问题
如果 com 里有某条事实 resolves(事实, q):
  把 qud 的第一项划掉
```

用户答完课程后，最上面从「哪门课」变成下面的「教室在哪」。`com` 是空的时，循环进不去，规则用不上。

## 170–192 行：`find_plan`

```text
如果 agenda 第一项是 respond:
  在 domain 的计划里找
    type 是 issue，而且针对的问题跟现在这个一样
  找到:
    agenda 删掉这第一项
    plan 换成那一份步骤
```

「课在哪」对得上，`plan` 变成 `[问课程, 查表]`。「最喜欢的食物」对不上，`plan` 还是空的，后面改用 `bel` 来答。

它和 `downdate_qud` 写在同一步里，谁先用得上就执行谁。一次只走一条。

## 195–213 行：`remove_findout`

```text
如果 plan 第一项是 findout:
  这个问题在 com 里已经有答案:
    删掉 plan 的第一项
```

问完「哪门课」时，这一步还留在 `plan` 里。等用户的答案进了 `com`，这里才把它撕掉。用户如果答非所问，这一步还在，下一轮还会再问一次。

`findout` 和 `raise` 的差别就在这：`raise` 是一问出口就从 `plan` 删掉；`findout` 要等到答案进了 `com` 才删。

## 216–237 行：`exec_consultDB`

```text
如果 plan 第一项是 consultDB:
  结果 = database.consultDB(这个问题, com)
  如果结果不是 null:
    plan 删掉第一项
    bel 追加这条结果
```

查表结果先进 `bel`，不直接进 `com`，也不直接变成台词。要等后面的 `select_respond` 和 `select_answer` 才说出来。说出去之后，下一轮的 `integrate_answer` 才会把它放进 `com`。

## 243–254 行：`select_from_plan`

```text
如果 agenda 是空的，并且 plan 还有第一项:
  把这第一项抄一份到 agenda 前面
  plan 本身不删
```

这是把「能留到下一轮的步骤」抄一张到「这一轮要做的事」上。这一轮 Update 会清掉 `agenda` 上的副本。`plan` 里的原件还在，所以下一轮还能再拿。

## 257–278 行：`select_ask`

```text
如果 agenda 第一项是 findout 或 raise:
  做一个 ask move，追加到 next_moves
  如果 plan 第一项正好是 raise:
    同时把 plan 第一项删掉
  findout 不删 plan
```

现在的计划只用 `findout`。所以问出 “Which course?” 时，这一步还留在 `plan` 里。

## 281–304 行：`select_respond`

```text
如果 agenda 空、plan 空、qud 还有问题:
  在 bel 里找一条
    还没出现在 com 里
    而且 relevant 说它能答最上面那个问题
  找到就把 { respond, 这个问题 } 放进 agenda
```

三个条件一起卡时机：计划还没做完，不许拿 `bel` 抢着答。食物问题没有计划，所以可以直接用 `bel`。教室问题要等「问课程、查表」都做完，`plan` 空了，G212 已经在 `bel` 里，这条才用得上。

## 306–322 行：`select_answer`

```text
如果 agenda 第一项是 respond:
  在 bel 里找一条还没进 com、而且能回答这个问题的事实
  做一个 answer move，追加到 next_moves
```

“Pizza.” 和 “The lecture is in G212.” 都是这里产生的。差别只是事实从哪来：食物一开始就在 `bel` 里，教室是刚刚查表写进去的。

## 325–332 行：`select_other`

```text
如果 agenda 第一项是 greet:
  把这个动作本身当成 move，追加到 next_moves
```

`greet` 的形状碰巧和 `move` 一样，所以直接放进去。`nlg` 再把它说成开场白。

## 现有两段对话各自点中哪些规则

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
