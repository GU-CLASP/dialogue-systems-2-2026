# `sisu/src/types.ts`

这个文件不做事。它只规定后面传来传去的数据长什么样。后面看到的 `qud`、`agenda`、`SAYS`，形状都在这里定死。

## 折叠大纲

```text
types.ts
├─ 1        SpeechState 传进来的事件
├─ 3–9      domain：这个小系统认识哪些词、有哪些计划
├─ 11–19    一条计划，以及查表函数
├─ 21–28    短回答、一条事实、一个问题
├─ 30–43    move：打招呼、回答、提问
├─ 45–53    action：计划里的一步，用户听不见
├─ 57–67    InformationState 整份记录
├─ 69–85    语音那层和纯对话那层各多带什么
└─ 87–102   事件：CLICK、SAYS、NEXT_MOVES
```

## 第 1 行

`SpeechState` 会发出「听完了」「说完了」「没人说话」这种事件。只有 `isu.ts` 用它们。`dme` 不听这些。

## 3–19 行：`domain` 和查表函数

`domain` 就是这个小对话系统的家底：它认识哪些词，遇到某个问题打算按什么步骤办。

```text
domain = {
  predicates:   问题用的名字 -> 它属于哪一类
                例如 booking_course -> course
  individuals:  一个具体的词 -> 它属于哪一类
                例如 LT2319 -> course
  plans:        遇到某个问题或动作时，步骤列表
}

一条计划 = {
  type:    "issue" 表示「为了解决一个问题」
  content: 这个计划针对哪个问题
  plan:    有先后顺序的 action
}

database.consultDB(问题, 已经说定的事实) -> 一条新事实，或者 null
```

「属于哪一类」是为了判断一个回答能不能用来答这个问题。`friday` 如果登记成 day，才能回答「哪一天」。具体登记表不在这个文件里，在 `is.ts`。

## 21–28 行：三种小数据

代码里表示「话的内容」就这三种，不要和整句英文搞混：

```text
ShortAnswer   一个字符串
              例如 "LT2319"、"pizza"
              用户刚答上来、还没配对成事实时用这个

Proposition   一条已经配对好的事实
              { predicate, argument }
              例如 { booking_room, G212 }
              predicate 是事情的名字，argument 是那个值

Question      一个问题，这里只有 wh-question
              { type: "whq", predicate }
              例如 { whq, booking_course }
              意思是「booking_course 的值是什么」
```

用户嘴里的短回答先是字符串。写进 `com` 或 `bel` 之后，会变成一条 `proposition`。

## 30–43 行：`move`

`move` 是「这句话是什么意思」，不是用户敲进去的原句。

```text
greet / request    打招呼，或者提出一个请求。内容是 null 或一个字符串
answer             回答。内容是短回答，或一条 proposition
ask                提问。内容是一个 question
```

`nlu` 负责把原句变成 `move`。规则只看 `move`。`nlg` 再把 `move` 变回英文。

## 45–53 行：`action`

`action` 是系统私下要做的事，用户听不见。

```text
greet       该打招呼了
respond     该回答 qud 最上面那个问题了
            注释写了：不要把它写进 domain 的计划里
raise       把一个问题提出来。说出口时，这一步会从 plan 里删掉
findout     还缺这个信息，要问用户
            问出去以后先留在 plan 里，等答案进了 com 再删
consultDB   拿已经说定的事实去查表
```

`content` 通常就是要问或要答的那个 `question`。打招呼时没有内容，是 `null`。

## 57–67 行：整份记录

```text
next_moves   这一轮准备交给外面去说的 move 列表
domain       家底，开场时写好，对话过程中一般不改
database     查表函数
private
  agenda     这一轮的动作，进入 Update 时会被清空
  plan       可以留到下一轮的步骤
  bel        系统知道、还没说出口的事实
shared
  lu         最近一句：谁说的，哪些 move
  qud        问题列表，下标 0 是最急的那个
  com        已经说定的事实，新的放在最前面
```

## 69–85 行：外面多带的两个字段

对话记录本身叫 `is`。包在外面的程序还会多记一点：

```text
latest_speaker / latest_moves
  刚收到、还没抄进 lu 的那一句

语音那层 DMContext 还多：
  ssRef            SpeechState 那块程序
  lastUserMoves    刚刚识别出来、还没送进 dme 的 move

测试和语音外壳 DMEContext 还多：
  parentRef        外面那台程序，用来把 NEXT_MOVES 送回去
```

测试和浏览器各包一层，再把同一份 `is` 交给 `dme`。

## 87–102 行：事件名字

```text
CLICK         用户按下开始按钮
SAYS          有人说了一句。带着 speaker 和 moves
NEXT_MOVES    dme 请外面把这些 move 说出去
SpeechState 的事件
              只在 isu.ts 里出现，例如听完、说完
```

`dme` 自己发的是 `NEXT_MOVES`。它听的是 `SAYS`。英文原句不进 `dme`。
