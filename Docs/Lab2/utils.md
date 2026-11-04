# `sisu/src/utils.ts`

小工具。领域、规则和生成句子时都用它们，避免手写重复的对象。

## 折叠大纲

```text
utils.ts
├─ 3–31   objectsEqual 深度比较两个值
├─ 33–38  WHQ 造一个 wh-问题
├─ 40–45  findout 造「去问用户」这一步
├─ 47–52  consultDB 造「去查库」这一步
└─ 54–60  getFactArgument 从事实列表里取某个谓词的论元
```

## 3–31 行：`objectsEqual`

伪代码：

```text
objectsEqual(a, b):
  如果 a 和 b 是同一个值，返回真
  如果有一个不是对象，或有一个是 null，返回假
  如果键的数量不同，返回假
  每个键都要两边都有，并且值再递归比较
  全部相同才返回真
```

规则用它判断「这个计划是不是针对当前这个问题」。`nlg` 用它在对照表里找和某个 Move 完全相同的那一行。键顺序不影响结果，因为比较的是键名和值，不是字符串序列化。

## 33–52 行：三个构造函数

```text
WHQ("booking_course")
  -> { type: "whq", predicate: "booking_course" }

findout(这个问题)
  -> { type: "findout", content: 这个问题 }

consultDB(这个问题)
  -> { type: "consultDB", content: 这个问题 }
```

`is.ts` 写计划时只调用这些函数，不手写对象。

## 54–60 行：`getFactArgument`

```text
getFactArgument(事实列表, 谓词):
  找到第一条 predicate 等于该谓词的事实
  返回它的 argument
  找不到则没有返回值
```

现在的数据库查询用它从 `com` 里取出课程代码。后面如果要同时看星期和课程，同样是从事实列表里按谓词各取一个论元。
