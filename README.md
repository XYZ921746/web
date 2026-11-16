# ElainaChat Mod · 插件商店与官网

本仓库承载两样东西，都以 GitHub Pages 静态托管（`https://xyz921746.github.io/web/`）：

- **插件商店索引**：`store/index.json` + `store/packages/*.zip`，应用内「插件市场」从这里拉索引、下 zip；
- **官网**：`index.html` / `catalog.js` / `models/` 等静态页。

程序本体（宿主）在 [`XYZ921746/ElainaChat-mod`](https://github.com/XYZ921746/ElainaChat-mod)；本仓库只放插件生态与官网，**改宿主请去那边提 PR**。

## 目录结构

| 路径 | 放什么 |
| --- | --- |
| `plugins/<id>/` | 插件源码：`manifest.json` + `index.js`（+ 样式 / 资源 / README.md） |
| `store/index.json` | 商店索引：每个插件一条，人工字段 + 打包产物信息 |
| `store/packages/` | 打包产物 `<id>-<版本>.zip`（zip 根目录直接是文件，不要再套一层目录） |
| `store/models.json` | Live2D 模型索引（与插件索引平行，投稿走 `models/submit/` 页） |

## 插件投稿指南（fork + PR）

投稿 = **fork 本仓库 → 加插件 → 发 PR**。合并即上架：Pages 自动重新发布，应用内市场立刻可装。Issues 投稿通道已下线。

### 步骤

1. **Fork 本仓库**，从 `main` 建一个分支（名字随意，如 `add/my-mod`）。
2. **放入插件源码**：`plugins/<id>/`，其中 `<id>` 与 `manifest.json` 里的 `id` 一致（小写字母 / 数字 / 连字符）。
   - 清单里**显式写 `id`**；不要占用宿主的 API 前缀与静态地址（撞名会被拒绝装载）。
   - 大二进制（Live2D 模型等）不要打进插件目录——它们属于 `store/models.json` 那条线。
3. **登记索引**：在 `store/index.json` 的 `plugins` 数组加一条：
   - 必填：`id` / `name` / `version` / `kind`（`ui` 界面 / `resource` 资源）/ `author` / `license` / `description`；
   - `thirdParty: true` **必填**（社区投稿一律标它）——客户端会把条目放进「第三方插件」分区并显示未审查警告；
     经维护者审查转正时由维护者移除该字段；
   - `downloadUrl` / `sizeBytes` 先按预期值占位（`https://xyz921746.github.io/web/store/packages/<id>-<版本>.zip`），
     打包后由维护者校正；`usage`（商用授权）与 `readmeUrl`（插件说明）尽量给全。
4. **发 PR**：标题 `[插件投稿] <名字>`，PR 模板自带检查单，逐项打勾。
5. **维护者审查**：
   - 标了 `thirdParty: true` 的条目 = **未经审查**进第三方分区（客户端自动显示警告），审查只看合法权益（授权、源码、
     无恶意内容）；合并即上架，后续使用风险由使用者自担；
   - 想进**官方列表**（无未审查警告、进普通分区）的插件，维护者会多做一轮代码审查，时间不定，可在 PR 里说明意愿；
   - 打包（`store/packages/<id>-<版本>.zip`）与索引产物字段校正由维护者完成；作者愿意自带 zip 的话，PR 里附上即可。

### 审查底线（PR 会被拒的情况）

- 代码与资源**无权分发**，或拒绝提供源码地址；
- `manifest.json` 缺 `id`、或与已有插件 / 宿主地址冲突；
- zip 结构不对（多套一层目录）、夹带大二进制；
- 明显恶意行为：偷数据、未声明的外联、伪装成宿主界面骗授权。

### 更新已有插件

同一套流程：fork → 改 `plugins/<id>/` → 索引里 `version` 抬版本 → PR 标题 `[插件更新] <名字>`。

## License

- 宿主与官方插件：GPLv3（见 ElainaChat-mod 仓库）；
- 第三方插件的授权以 `store/index.json` 各条目的 `license` / `usage` 字段为准。
