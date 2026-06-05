---
name: spec-kit
description: 在开发新功能（feature）时使用此 skill。它强制执行一套"先写 spec 和 plan 文档、再实现、最后回顾文档与 README"的开发流程。当用户提到开发新功能、新增模块、实现某个功能时应主动使用，若是 小功能修改 或者 用户明确不使用 spec 则不使用。
---

# Spec-Kit

开发新功能时遵循"规格先行"的工作流。**任何新功能的开发都必须严格按以下四个阶段顺序执行。**

> 当前为快速开发阶段，在改造旧模块或者是增加新功能的时候，不需要刻意考虑存量数据的兼容与迁移问题。

## 触发时机

当用户要求开发新功能 / 新增模块 / 实现某个 feature 时启动此流程。(不包含 bugfix 时)

## 工作流程

### 阶段 1：编写 Spec 文档

实现任何新功能**之前**，先编写规格文档：

1. 把功能点与实现细节完整列出，如有不清楚的点，需要询问用户
2. 按照 `templates/spec-template.md` 的格式编写
3. 保存到 `doc/spec/<功能模块名>.md`
4. 后续所有实现都必须遵守此 spec 的约束
5. 编写完成后告知用户，让用户确认。

### 阶段 2：编写 Plan 文档

Spec 确认后，编写一份完整且详细的实现计划：

1. 拆解实现步骤、涉及文件、依赖关系
2. 保存到 `doc/plan/<功能模块名>.md`

### 阶段 3：实现代码

按照 plan 与 spec 进行编码实现。

### 阶段 4：回顾与同步文档

代码完成后必须执行以下检查：

1. **回顾 Spec**：重新审视 spec 文档，检查是否有：
  - 功能遗漏
  - 部分功能因受限未完全实现

   若存在以上情况，**必须明确告知用户**，并同步修改 spec 文档（特别是 `Known Limits` 部分）。

2. **更新 README**：检查以下文件是否需要更新描述，若需要则修改：
  - 根目录 `README.md`
  - `apps/server/README.md`（如果存在）
  - `apps/desktop/README.md`（如果存在）

## Spec 文档格式

详见 `templates/spec-template.md`。Spec 文档必须包含但不限于以下部分：
Context、Model、Backend API、Runtime Flow、Validation、Known Limits。
