# `sisu/src/nlug.ts`

听和说都靠两张对照表。

- `nlu`：用户的英文整句 -> `move`
- `nlg`：系统的 `move` -> 英文整句

对不上的时候，听的那边当没听懂；说的那边直接报错。

`dme` 不调用这个文件。调用它的是测试和 `isu.ts`。

## 折叠大纲

```text
nlug.ts
├─ 5–7    两张表的类型
├─ 9–40   听得懂的句子
├─ 41–58  说得出来的句子
├─ 60–72  nlg
└─ 76–78  nlu
```

## 9–40 行：听得懂的五句

查表前会把整句转成小写，所以表里全是小写。

| 用户原句 | 变成的 `move` |
|---|---|
| where is the lecture? | 问 `booking_room` |
| what's your favorite food? | 问 `favorite_food` |
| pizza | 短回答 `pizza` |
| dialogue systems 2 | 短回答 `LT2319` |
| dialogue systems | 短回答 `LT2319` |

测试里写的是 `What's your favorite food?` 和 `Dialogue Systems 2`。函数里先做了 `toLowerCase()`，所以对得上。

表里没有 friday、thursday，也没有系统要说的「Sorry, I don't understand」。没听懂不是表里的一行：键不存在时，`nlu` 返回空数组 `[]`。

## 41–58 行：说得出来的四句

| `move` | 念出来 |
|---|---|
| 问 `booking_course` | Which course? |
| greet | Hello! You can ask me anything! |
| 回答 favorite_food = pizza | Pizza. |
| 回答 booking_room = G212 | The lecture is in G212. |

匹配要整份对象都一样，不是只看 `predicate`。房间如果变成 J440，表里却只有 G212，`nlg` 会抛错，测试也会失败。

## 60–72 行：`nlg`

```text
nlg(一组 move):
  对每一个 move:
    在表里找完全相同的那一行
    找不到就抛出 Failed to generate move
  把找到的英文用一个空格接成一句
```

所以同一轮 `next_moves` 里如果有两个 `move`，用户会听到一句里的两小句，中间一个空格。现在每轮实际上只选出一个 `move`。

## 76–78 行：`nlu`

```text
nlu(原句):
  用小写后的整句当键去查表
  查到就返回那组 move
  查不到就返回 []
```

`[]` 的意思是「一个 `move` 都没有」，不是 `undefined`。如果以后要识别「没听懂」，就看最新这组 `move` 是不是空的。

现在的规则没有这条分支。空数组会静静走完 Update。没有新问题，也没有新事实，系统就可能一句话都不说。
