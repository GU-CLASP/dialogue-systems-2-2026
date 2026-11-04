# `sisu/src/utils.ts`

几个小函数。`is.ts`、`rules.ts`、`nlug.ts` 都用它们，免得每次手写同样的对象。

## 折叠大纲

```text
utils.ts
├─ 3–31   objectsEqual 两个值是不是一样
├─ 33–38  WHQ 做一个 wh-question
├─ 40–45  findout 做「去问用户」这一步
├─ 47–52  consultDB 做「去查表」这一步
└─ 54–60  getFactArgument 从事实列表里取出某个值
```

## 3–31 行：`objectsEqual`

```text
objectsEqual(a, b):
  a 和 b 是同一个值 -> 一样
  有一个不是对象，或者有一个是 null -> 不一样
  两边的字段数量不同 -> 不一样
  每个字段两边都要有，值再递归比一次
  全部相同才算一样
```

规则用它判断「这份计划是不是针对现在这个问题」。`nlg` 用它在对照表里找和某个 `move` 完全相同的那一行。字段顺序无所谓，比的是字段名和值。

## 33–52 行：三个造数据的函数

```text
WHQ("booking_course")
  -> { type: "whq", predicate: "booking_course" }
  意思是「课程是什么」

findout(这个问题)
  -> { type: "findout", content: 这个问题 }

consultDB(这个问题)
  -> { type: "consultDB", content: 这个问题 }
```

`is.ts` 写计划时只调这些函数。

## 54–60 行：`getFactArgument`

```text
getFactArgument(事实列表, predicate 的名字):
  找到第一条 predicate 对上的事实
  返回它的 argument
  找不到就没有返回值
```

现在查教室时，用它从 `com` 里把课程代码拿出来。以后要同时看星期和课程，也是按名字各取一个 `argument`。
