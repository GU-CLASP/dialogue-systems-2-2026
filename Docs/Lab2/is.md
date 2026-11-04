# `sisu/src/is.ts`

对话开始时的那一份信息状态。领域知识、数据库和开场白都写在这里。规则不写死「教室是 G212」，它们只调用这里的 `consultDB`。

## 折叠大纲

```text
is.ts
└─ 10–60  initialIS()
   ├─ 11–15  谓词到种类
   ├─ 16–20  个体到种类
   ├─ 22–35  计划
   ├─ 36–46  数据库
   └─ 47–58  私有区和共享区的初值
```

## 11–20 行：词汇的种类

```text
谓词
  favorite_food   -> food
  booking_course  -> course

个体
  pizza           -> food
  LT2319          -> course
```

还没有「星期」。问句 `booking_room` 有计划，但房间号不是个体表里的词，它是数据库返回的命题论元。

## 22–35 行：唯一的一条计划

```text
如果要解决的问题是 booking_room（课在哪）:
  第 1 步  findout booking_course   先问哪门课
  第 2 步  consultDB booking_room   再查教室
```

食物问题没有计划。它不走这里，直接从信念里答。

## 36–46 行：数据库

```text
consultDB(问题, 已确认事实):
  如果问题是 booking_room:
    课程 = 事实里 booking_course 的论元
    如果课程是 LT2319:
      返回 { booking_room, G212 }
  返回 null
```

查不到就返回 `null`。规则 `exec_consultDB` 看到 `null` 就不会把这一步从计划里删掉，系统也就不会编一个房间出来。

## 47–58 行：开场时各列表

```text
next_moves = 空
plan       = 空          还没有触发「课在哪」
agenda     = [ greet ]   所以第一句一定是打招呼
bel        = [ { favorite_food, pizza } ]
lu         = 还没有
qud        = 空
com        = 空
```

`agenda` 里的 `greet` 会被 `select_other` 说出去。说完进入 Update，`clear_agenda` 把它清掉。打招呼不会留在计划里。
