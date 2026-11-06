# `sisu/src/semantics.ts`

三个小函数。它们不改记录，只回答一件事：这句回答，算不算在答当前那个问题。规则自己不写这个判断。

## 折叠大纲

```text
semantics.ts
├─ 3–18   relevant   这个回答和问题搭不搭
├─ 20–25  resolves   这条事实有没有把问题解决掉
└─ 27–43  combine    把一句短回答收成一条事实
```

## 3–18 行：`relevant`

搭不搭，看两边是不是同一类东西。

```text
relevant(domain, 回答, 问题):
  如果回答只是一个字符串:
    问题那个 predicate 属于哪一类
    这个字符串在 individuals 里属于哪一类
    两类相同 -> 搭
  如果回答已经是一条 proposition:
    两边的 predicate 相同 -> 搭
  否则不搭
```

例子：问题是 `booking_course`，这一类是 `course`。短回答 `LT2319` 也登记成 `course`，所以搭。`pizza` 登记成 `food`，不搭，不会写进 `com`。

`bel` 里的 `{ favorite_food, pizza }` 对问题 `favorite_food` 也搭，因为 `predicate` 相同。

## 20–25 行：`resolves`

```text
resolves(回答, 问题):
  只有回答已经是一条 proposition，而且 predicate 相同，才算这个问题解决了
  光是一个字符串，不算解决
```

所以要分两步。`integrate_answer` 先用 `relevant` 和 `combine`，把短回答收成事实，放进 `com`。下一步 `downdate_qud` 和 `remove_findout` 再看 `com` 里的事实能不能把问题划掉。

## 27–43 行：`combine`

```text
combine(domain, 问题, 回答):
  回答是字符串，而且类别对得上:
    做成 { predicate: 问题的名字, argument: 这个字符串 }
  回答已经是同名的 proposition:
    原样返回
  对不上:
    抛错 Combine failed
```

`"LT2319"` 加上问题 `booking_course`，就变成 `{ predicate: "booking_course", argument: "LT2319" }`。后面的查表函数读的就是这条。
