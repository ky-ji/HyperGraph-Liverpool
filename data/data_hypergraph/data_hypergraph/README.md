# 足球战术超图数据说明

## 1. 项目简介

本目录包含一份足球比赛事件数据，并已转换为适合“超图（Hypergraph）”可视化的数据格式。

核心目标：

1. 用超图表达一次进攻中“多人协同”的整体关系。
2. 同时保留普通图（二元边）用于对比。
3. 按不同战术维度（回合/边路/模式/章节）拆分，便于展示和分析。

## 2. 文件结构

- `data.json`：原始数据（来自比赛事件处理结果）。
- `build_hypergraph_json.py`：转换脚本。
- `derived/`：转换后的标准 JSON 文件。

`derived/` 内文件：

1. `data_schema_summary.json`：原始数据结构说明与统计。
2. `hypergraphs_phase.json`：按“每次进攻回合”组织的超图数据。
3. `hypergraphs_lane.json`：按“进攻通道（left/center/right）”聚合的超图数据。
4. `hypergraphs_pattern.json`：按“进攻模式（pattern）”聚合的超图数据。
5. `hypergraphs_chapter.json`：按“叙事章节（chapter）”聚合的超图数据。
6. `manifest.json`：生成文件清单。

## 3. 原始数据 `data.json` 结构

注意：`data.json` 是 JavaScript 赋值格式，不是严格 JSON。

开头形式为：

```js
window.LIVERPOOL_HYPERGRAPH_DATA = { ... };
```

主要顶层字段：

| 字段                 | 类型   | 含义                               |
| -------------------- | ------ | ---------------------------------- |
| `match`            | object | 比赛元信息（对阵、日期、比分等）   |
| `legend`           | object | 图例说明                           |
| `players`          | array  | 球员列表（含名字、角色、平均站位） |
| `phases`           | array  | 进攻回合列表（核心分析单元）       |
| `chapters`         | array  | 叙事章节（由多个 phase 组成）      |
| `summary`          | object | 汇总统计                           |
| `summaryBreakdown` | object | 按 outcome/lane/pattern 的细分统计 |
| `presentation`     | object | 展示参数（自动播放顺序等）         |

## 4. 超图是如何编码的

在转换后的数据中，超图表达规则统一如下：

1. 顶点（Vertex）

- 使用 `nodes` 表示。
- 每个节点对应一个球员，关键字段有 `id`、`name`、`role`、`avgX`、`avgY`。

2. 超边（Hyperedge）

- 使用 `hyperedges` 表示。
- 每条超边的 `members` 是一个球员 ID 列表，可同时包含多个球员。
- `order` 表示超边阶数（即成员数量）。

3. 普通边（Pairwise Edge）

- 使用 `graphEdges` 表示。
- 每条边只有 `source -> target` 两个端点，通常对应一次传球关系。

4. 时间与事件序列

- 使用 `eventPath` 表示事件链路，包含 `seq`、`absoluteSecond`、`start/end` 坐标、是否射门/进球等。

## 5. `hypergraphs_phase.json`（最推荐的主展示文件）

该文件适合做“逐回合播放”或“单回合战术解读”。

顶层结构：

1. `schemaVersion` / `datasetType`
2. `match`
3. `nodes`
4. `hypergraphs`（数组，每个元素是一段进攻回合）

单个 `hypergraphs[i]` 结构：

- `id`, `title`
- `time`：分钟、半场、起止时间、持续时长
- `tactics`：`outcome`, `lane`, `pattern`, `progression`, `impactScore`
- `hyperedges`：多人协作关系（超图核心）
- `graphEdges`：传球骨架（普通图）
- `eventPath`：动作时间轴
- `comparison`：超图和普通图的对比指标（如 `hyperedgeOrder`, `graphEdgeCount`）

示例（简化）：

```json
{
  "id": "phase-01",
  "tactics": {
    "outcome": "shot",
    "lane": "center",
    "pattern": "wide delivery"
  },
  "hyperedges": [
    {
      "id": "phase-01-unit",
      "members": [18550, 120353, 14870, 25747, 4908],
      "order": 5
    }
  ],
  "graphEdges": [
    {"source": 18550, "target": 120353, "kind": "pass"}
  ]
}
```

## 6. 关于“时间/位置是否固定”

1. 比赛日期固定：`match.date` 是整场比赛元信息。
2. 回合时间不固定：每个 `phase` 的 `time` 不同。
3. 事件时间不固定：`eventPath` 每条事件都有独立时间戳。
4. 球员位置分两类：

- `nodes.avgX/avgY` 是平均位置（静态锚点）。
- `eventPath.start/end` 是每次动作的位置（动态变化）。

## 7. 可视化使用建议

1. 做“战术回放”：使用 `hypergraphs_phase.json`。
2. 做“左右中路对比”：使用 `hypergraphs_lane.json`。
3. 做“战术风格对比”：使用 `hypergraphs_pattern.json`。
4. 做“故事线展示”：使用 `hypergraphs_chapter.json`。

---

建议统一把：

- `nodes` 当作球员主表；
- `hyperedges.members` 当作超边成员；
- `graphEdges` 当作普通图层；
- `eventPath` 当作时间动画层。
