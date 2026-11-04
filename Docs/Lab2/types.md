# `sisu/src/types.ts`

这个文件不跑逻辑。它规定后面所有文件能传递的数据长什么样。读规则时看到的 `qud`、`agenda`、`SAYS`，形状都在这里。

## 折叠大纲

```text
types.ts
├─ 1        引入 SpeechState 的外部事件
├─ 3–9      Domain 领域：谓词、个体、计划
├─ 11–19    PlanInfo 与 Database
├─ 21–28    短回答、命题、问题
├─ 30–43    Move：打招呼 / 回答 / 提问
├─ 45–53    Action：计划里的一步
├─ 57–67    InformationState
├─ 69–85    两层上下文：语音外壳 与 纯引擎
└─ 87–102   事件：CLICK、SAYS、NEXT_MOVES
```

## 1 行：SpeechState 事件

`DMEvent` 里有一项来自语音库：识别完成、说完、没听清等。纯引擎 `dme` 不使用这些事件。只有 `isu.ts` 的外壳在用。

## 3–19 行：领域和数据库

```text
Domain = {
  predicates:  谓词 -> 种类     例如 booking_course -> course
  individuals: 个体 -> 种类     例如 LT2319 -> course
  plans:       遇到某个问题或动作时，按什么步骤处理
}

PlanInfo = {
  type:    "issue" 表示「为了解决一个问题」
  content: 这个计划对应的问题
  plan:    有序的 Action 列表
}

Database.consultDB(问题, 已经确认的事实) -> 一条新事实，或 null
```

种类用来判断「星期五」能不能回答「哪一天」。谓词和个体的种类相同，这个短回答才相关。具体表格不在这个文件里，在 `is.ts`。

## 21–28 行：三种语义小物

```text
ShortAnswer = 字符串                 例如 "LT2319"、"pizza"
Proposition = { predicate, argument } 例如 { booking_room, G212 }
Question    = { type: "whq", predicate } 例如 { whq, booking_course }
```

用户嘴里的短回答是字符串。写进 `com` 或 `bel` 之后会变成命题。问题在这套代码里只有 wh-问句，没有是非问句。

## 30–43 行：Move

Move 是「已经理解好的一句话」，不是原始字符串。

```text
greet / request   内容是 null 或一个字符串
answer            内容是短回答或命题
ask               内容是一个问题
```

`nlu` 产出 Move。规则只看 Move。`nlg` 再把 Move 变回句子。

## 45–53 行：Action

Action 是系统私下要做的事，用户听不见。

```text
greet      该打招呼了
respond    该回答栈顶问题了。注释写明：不要写进领域计划
raise      把一个问题提出来。选出问题时会把这一步从 plan 删掉
findout    还缺这个信息，要问用户。问完先留在 plan 里，等答案进了 com 再删
consultDB  拿已有事实去查数据库
```

`content` 通常是要问或要答的那个 `Question`。打招呼时是 `null`。

## 57–67 行：InformationState

```text
next_moves  这一轮要发给外层去说的 Move 列表
domain      静态领域
database    查询函数
private
  agenda    本轮动作栈，进入 Update 时会被清空
  plan      跨轮次的步骤
  bel       系统相信但未必已经说出来的命题
shared
  lu        最近一句：说话人 + Move 列表
  qud       问题栈，下标 0 是当前最急的问题
  com       已确认命题，新的放在前面
```

## 69–85 行：两层上下文

```text
TotalInformationState
  latest_speaker / latest_moves   刚收到、还没抄进 lu 的那一句
  is                              真正的信息状态

DMContext   语音外壳多用的字段：ssRef 语音演员，lastUserMoves
DMEContext  纯引擎多用的字段：parentRef 外层演员，用来回传 NEXT_MOVES
```

测试和浏览器各包一层，再把同一份 `is` 交给 `dme`。

## 87–102 行：事件

```text
CLICK          用户按下开始按钮
SAYS           { speaker, moves }  有人说了一句语义
NEXT_MOVES     Move[]              引擎请外层把这些话说出去
SpeechState 的事件                  只在语音外壳里出现
```

引擎自己发出的是 `NEXT_MOVES`。它听的是 `SAYS`。字符串不进引擎。
