# `sisu/src/is.ts`

对话开始时脑子里的那一份记录。认识哪些词、有什么计划、表里有什么、第一句要说什么，都写在这里。

规则里没有写死「教室是 G212」。它们只调用这里的 `consultDB`。

## 折叠大纲

```text
is.ts
└─ 10–60  initialIS()
   ├─ 11–15  predicate 属于哪一类
   ├─ 16–20  具体的词属于哪一类
   ├─ 22–35  计划
   ├─ 36–46  查表
   └─ 47–58  各张列表的初值
```

## 11–20 行：词是分好类的

```text
predicate
  favorite_food   -> food
  booking_course  -> course

individual
  pizza           -> food
  LT2319          -> course
```

还没有「星期几」。`booking_room` 有计划，但房间号不是这里登记的词。房间号是查表之后返回的那条事实里的 `argument`。

## 22–35 行：现在只有一条计划

```text
如果要解决的问题是 booking_room（课在哪间房）:
  第 1 步  findout booking_course    先问哪门课
  第 2 步  consultDB booking_room    再查教室
```

「最喜欢吃什么」没有计划。它不走这里，直接从 `bel` 里答。

## 36–46 行：表里只有一行

```text
consultDB(问题, 已经说定的事实):
  如果问的是 booking_room:
    课程 = 事实里 booking_course 的 argument
    如果课程是 LT2319:
      返回 { booking_room, G212 }
  否则返回 null
```

查不到就返回 `null`。规则看到 `null` 不会把这一步从 `plan` 里撕掉，也不会编一个房间出来。

## 47–58 行：开场时各张列表

```text
next_moves = 空
plan       = 空                 还没人问「课在哪」
agenda     = [ greet ]          所以第一句一定是打招呼
bel        = [ { favorite_food, pizza } ]
lu         = 还没有
qud        = 空
com        = 空
```

`agenda` 里的 `greet` 会被选中并说出去。说完进入 Update，`clear_agenda` 把它清掉。打招呼不会留在 `plan` 里。
