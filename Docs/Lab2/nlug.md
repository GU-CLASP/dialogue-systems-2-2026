# `sisu/src/nlug.ts`

自然语言这一层只有两张表。`nlu` 把用户字符串变成 Move。`nlg` 把系统 Move 变成字符串。对不上就听不懂，或者直接抛错。

引擎不调用这个文件。调用它的是测试和 `isu.ts`。

## 折叠大纲

```text
nlug.ts
├─ 5–7    两张表的类型
├─ 9–40   nluMapping 听得懂的句子
├─ 41–58  nlgMapping 说得出来的句子
├─ 60–72  nlg
└─ 76–78  nlu
```

## 9–40 行：听得懂的五句

键会先被转成小写，所以表里全是小写。

| 用户字符串 | 变成的 Move |
|---|---|
| where is the lecture? | 问 `booking_room` |
| what's your favorite food? | 问 `favorite_food` |
| pizza | 短回答 `pizza` |
| dialogue systems 2 | 短回答 `LT2319` |
| dialogue systems | 短回答 `LT2319` |

注意测试里写的是 `What's your favorite food?` 和 `Dialogue Systems 2`。函数内部先 `toLowerCase()`，所以能对上。

这里没有 friday、thursday，也没有「听不懂」这种系统会说的话。听不懂不是表里的一项：表里没有的键，`nlu` 返回空数组。

## 41–58 行：说得出来的四句

| Move | 说出来 |
|---|---|
| 问 `booking_course` | Which course? |
| greet | Hello! You can ask me anything! |
| 回答 favorite_food = pizza | Pizza. |
| 回答 booking_room = G212 | The lecture is in G212. |

匹配是整份对象深度相等，不是只看谓词。房间如果变成 J440，而表里只有 G212，`nlg` 会抛错，测试也会失败。

## 60–72 行：`nlg`

```text
nlg(一组 Move):
  对每个 Move:
    在表里找完全相同的那一行
    找不到就抛出 Failed to generate move
  把各句用一个空格接起来
```

所以同一轮如果 `next_moves` 里有两个 Move，用户会听到一句里的两小句，中间一个空格。现在每轮实际上只选出一个 Move。

## 76–78 行：`nlu`

```text
nlu(字符串):
  用小写后的整句当键去查表
  查到就返回那组 Move
  查不到就返回 []
```

空数组是「一个 Move 都没有」，不是 `undefined`。规则如果要识别听不懂，就看最新这组 Move 是不是空数组。当前规则没有这条分支，空数组会安静地走完 Update，然后因为没有新问题、也没有新事实，系统可能无话可说。
