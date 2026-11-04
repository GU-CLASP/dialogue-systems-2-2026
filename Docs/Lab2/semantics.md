# `sisu/src/semantics.ts`

三个纯函数，回答「这句答的是不是当前问题」。规则不自己做这个判断。

## 折叠大纲

```text
semantics.ts
├─ 3–18   relevant  这个回答和问题相不相关
├─ 20–25  resolves  这个命题有没有解决这个问题
└─ 27–43  combine   把短回答收成一条命题
```

## 3–18 行：`relevant`

```text
relevant(领域, 回答, 问题):
  如果回答是字符串:
    问题的谓词所属种类 == 这个字符串在个体表里的种类
    则相关
  如果回答已经是命题:
    命题的谓词 == 问题的谓词
    则相关
  否则不相关
```

例子：问题是 `booking_course`，种类是 `course`。短回答 `LT2319` 的种类也是 `course`，所以相关。短回答 `pizza` 的种类是 `food`，不相关，不会写进 `com`。

系统信念里的 `{ favorite_food, pizza }` 对问题 `favorite_food` 相关，因为它是同谓词的命题。

## 20–25 行：`resolves`

```text
resolves(回答, 问题):
  只有回答已经是命题，并且谓词相同，才算解决了问题
  短回答字符串不算
```

所以流程是两步：`integrate_answer` 先用 `relevant` + `combine` 把短回答收成命题，放进 `com`。下一阶段 `downdate_qud` 和 `remove_findout` 再用 `resolves` 看 `com` 里的命题能不能把问题划掉。

## 27–43 行：`combine`

```text
combine(领域, 问题, 回答):
  如果回答是字符串，而且种类对得上:
    返回 { predicate: 问题的谓词, argument: 这个字符串 }
  如果回答已经是同谓词命题:
    原样返回
  否则抛出 Combine failed
```

`"LT2319"` 加上问题 `booking_course`，变成 `{ predicate: "booking_course", argument: "LT2319" }`。这就是后来数据库能读到的那条事实。
