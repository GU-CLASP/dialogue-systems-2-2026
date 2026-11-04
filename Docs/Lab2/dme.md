# `sisu/src/dme.ts`

这段程序决定下一句说什么。它不认识英文。它只按固定顺序去试 `rules.ts` 里的规则，该开口时通知外面。

一条规则在这里会被用两次：先问「现在用不用得上」，用得上才真正改记录。

## 折叠大纲

```text
dme.ts
├─ 12–22   isuTransition 把一条规则包成一次跳转
├─ 24–66   判断条件和真正要做的动作
│  ├─ 30–36   两条判断：规则用不用得上、刚才是不是用户
│  └─ 37–65   三个动作：送出去、改记录、记下刚听到的话
└─ 67–158  状态机
   ├─ 73–97    Select 选出要说的话
   └─ 98–156   Update 听一句，并改记录
```

## 12–22 行：`isuTransition`

```text
isuTransition(下一个状态, 规则名):
  能跳，仅当这条规则现在用得上
  跳的时候，真正执行这条规则
  跳到给定的下一个状态
```

文件头注释里还有第三个参数，代码没使用它。真正把话说出去的，是后面 `SelectionDone` 里单独写的那一下。

## 30–36 行：两条判断

```text
这条规则用不用得上:
  调用 rules[规则名](当前记录)
  规则返回 undefined -> 用不上
  规则返回一个「还没执行的修改函数」-> 用得上

刚才是不是用户:
  latest_speaker == "usr"
```

「用得上」只表示可以改，还没改。真正改记录，要等后面的动作把那个函数再调用一次。所以规则本身不能偷偷改东西，调用两次结果必须一样。现在的规则都是这样写的。

## 37–65 行：三个动作

```text
送出 next_moves:
  给 parentRef 发 { type: NEXT_MOVES, value: is.next_moves }

执行规则:
  再拿一次那个修改函数，调用它
  用新的 is 换掉旧的
  在控制台打印规则名和新记录

记下刚听到的 SAYS:
  latest_moves = 事件里的 moves
  latest_speaker = 事件里的 speaker
  把 is.next_moves 清空
```

清空 `next_moves` 是为了下一轮从空白开始加。不然上一轮已经说过的话会再说一遍。

## 73–97 行：Select，选出要说的话

这里三个小状态，都是一进来就按顺序试，不用等事件。

```text
先决定这一轮干什么，中了就去「把它变成一句人话」:
  1. select_respond
     计划做完了，但还有问题，而且 bel 里有答案
  2. select_from_plan
     agenda 是空的，plan 里还有下一步
  3. 两条都不中
     照样往下走
     打招呼走这里，因为 greet 已经在 agenda 里，不用再从 plan 拿

再把动作变成 move，中了就准备送出去:
  1. select_ask
     agenda 顶上是 findout 或 raise，变成一句问话
  2. select_answer
     agenda 顶上是 respond，从 bel 里拿答案
  3. select_other
     agenda 顶上是 greet，变成打招呼
  4. 都不中
     也往下走。这时 next_moves 可能还是空的

送出去:
  把当前 next_moves 发给外面
  Select 结束，进入 Update
```

一轮里，变成 `move` 的规则只会中一条。如果想让系统一口气说两小句，就要在中的那一条规则里，一次把两个 `move` 放进 `next_moves`。

## 98–156 行：Update，听一句并改记录

```text
一开始:
  一定先清空 agenda
  然后去等下一句

等待:
  干等 SAYS
  等到以后:
    记下这句话是谁说的
    把它抄进 shared.lu
    去「并进记录」

并进记录，按顺序试，中了就去下一步:
  integrate_usr_request    用户提出一个请求
  integrate_sys_ask         系统刚刚问了一个问题
  integrate_usr_ask         用户刚刚问了一个问题
  integrate_answer          这句是在回答当前问题
  integrate_greet           这句是打招呼
  都不中也往下走

接着，二选一:
  downdate_qud
    qud 最上面的问题，com 里已经有答案，把它划掉
  find_plan
    agenda 顶上是 respond，而且 domain 里有针对这个问题的计划
  都不中就去执行 plan

执行 plan，可以在自己身上多转几圈:
  remove_findout
    plan 顶上是 findout，而且 com 里已经有答案，撕掉这一步
  exec_consultDB
    plan 顶上是 consultDB，查表成功就把结果放进 bel，并撕掉这一步
  都不中，Update 结束
```

`remove_findout` 和 `exec_consultDB` 做完还停在「执行 plan」。所以同一次 Update 里可以先撕掉「问课程」，紧接着再「查教室」。

Update 结束后：

```text
如果刚才说话的是用户:
  去 Select，轮到系统开口
否则:
  回到 Update，系统刚刚说完，继续等
```

所以一问一答在程序里是这样转的：

```text
Select 说出问题
  -> Update 消化「系统刚才问了这个问题」
  -> 再等
  -> 用户的 SAYS 来了
  -> 收下回答，该查表就查表
  -> 因为说话人是用户，回到 Select
  -> 说出下一句
```

## 它和 `rules.ts` 怎么分工

`dme.ts` 决定先试谁、试中之后去哪。`rules.ts` 只回答「现在要不要改、改成什么样」。把 `always` 列表里的先后换一下，系统行为就会变，哪怕单条规则一个字没动。
