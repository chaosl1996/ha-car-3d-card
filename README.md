# 3D 汽车展示卡片 (Car 3D Card)

Home Assistant Lovelace 自定义卡片：在仪表盘中展示一辆可交互的 3D 汽车（Three.js 渲染），支持车门/尾门/车窗随实体状态开合、车灯泛光、车牌、胎压油量 HUD、自动旋转、点击车身切换俯视查看四轮胎压。

所有依赖（Three.js、后处理）与默认模型均已打包在发布包内，**下载即可用，无需外网 CDN**。

## 功能

- 🚗 3D 车模展示，鼠标拖拽旋转 / 滚轮缩放
- 🚪 四门 + 尾门随实体状态（lock / binary_sensor）开合动画，开合角度可调
- 💡 大灯 / 尾灯随 light 实体点亮：自发光 + 泛光 + 地面光池；近光/远光实体并联（任一亮即点亮）
- 🌈 背景颜色与不透明度可调（半透明背景可透出仪表盘主题）；地面展示盘大小可调，浅色背景自动切换为软阴影
- 🪟 车窗玻璃分色：前挡清亮，其余墨镜色（磨砂隐私玻璃质感）；四门窗 + 顶窗/天窗可分别关联实体，开窗玻璃渐隐
- 🛞 胎压 + 胎温 HUD（左下角），俯视时显示在四个轮毂旁；油量条 HUD（右下角），均可开关
- 🔖 中国车牌（蓝牌/绿牌），前后牌照自动贴到车身
- 🔄 自动旋转（可用 input_boolean 控制）、引擎运转时车轮转动 + 车身怠速微震
- 👆 点击车身进入俯视模式

## HACS 安装（推荐）

1. HACS → 右上角 ⋮ → **自定义存储库** → 仓库地址填本仓库 → 类别选 **Lovelace（仪表盘）** → 添加
2. 在 HACS 中打开「3D 汽车展示卡片」→ 下载
3. HACS 会将 `release.zip` 解压到 `/config/www/community/ha-car-3d-card/`（含模型与全部依赖）
4. 检查资源是否已注册：**设置 → 仪表盘 → 资源**，若无则手动添加：
   - URL：`/local/community/ha-car-3d-card/car-3d-card.js`
   - 类型：`JavaScript 模块`
5. 仪表盘添加卡片，搜索「3D 汽车」或手写配置（见下文）

> 卡片会自动按以下顺序查找依赖与模型：配置的 `base` → `/local/car3d` → `/local/community/ha-car-3d-card` → CDN。HACS 安装后**无需任何 base 配置**即可工作。

### ⚠️ HACS 安装后必看：资源清理与缓存

HACS 对 `zip_release` 仓库会错误地把资源注册为 `release.zip` 本身（无法作为 JS 加载）。安装后请在 **设置 → 仪表盘 → 资源** 中：

1. **删除** `/hacsfiles/ha-car-3d-card/release.zip?hacstag=...` 这条（HACS 每次更新后可能重新生成，再删一次即可）
2. **保留/添加** `/local/community/ha-car-3d-card/car-3d-card.js`（JavaScript 模块）

### 🔄 每次更新后看不到新版？

HA 对 `/local` 静态文件下发 **31 天强缓存**（`Cache-Control: max-age=2678400`），浏览器会把旧 JS 钉在缓存里，强刷也不一定能打掉。更新卡片后请把资源 URL 的版本参数 +1：

```
/local/community/ha-car-3d-card/car-3d-card.js?v=50
```

（数字任意，没出现过即可。改动 URL = 缓存键变化 = 必拉新文件。）验证：F12 控制台应显示 `CAR-3D-CARD v5.0.0`。

> **若无痕窗口也加载旧版**：检查 `/config/www/community/ha-car-3d-card/` 下是否有残留的 `car-3d-card.js.gz` —— HA 会优先发送预压缩变体，旧升级残留的 .gz 会让所有浏览器（包括无痕）拿到旧代码，删掉即可。

## 手动安装

1. 下载 `release.zip`，解压得到 16 个文件
2. 整体放入 `/config/www/car3d/`（或任意 www 下目录）
3. 资源：**设置 → 仪表盘 → 资源 → 添加**，URL 填 `/local/car3d/car-3d-card.js`，类型 `JavaScript 模块`

## 最小配置

```yaml
type: custom:car-3d-card
title: 我的汽车
plate_number: 甘M·DM815
plate_type: blue
```

## 完整配置示例

```yaml
type: custom:car-3d-card
title: 坦克300 · 甘M DM815
height: 480
bg_color: '#0e0e0e'        # 背景颜色
bg_opacity: 1              # 背景不透明度 0~1，<1 时透出卡片背后
ground_size: 1.2           # 地面展示盘直径（车长倍数，默认1.2）
light_color: '#fff2cc'     # 大灯颜色
light_brightness: 1.4      # 灯光亮度倍率（仅大灯；尾灯恒定）
plate_number: 甘M·DM815
plate_type: blue           # blue | green
# —— 车门（lock 或 binary_sensor，on/unlock = 开门）——
door_entities:
  lf_door: lock.tank300_door_lf
  rf_door: lock.tank300_door_rf
  lr_door: lock.tank300_door_lr
  rr_door: lock.tank300_door_rr
  trunk: lock.tank300_trunk
door_angle: 62             # 车门开启角度
trunk_angle: 75            # 尾门开启角度
# —— 车灯（任一大灯类实体亮则大灯亮）——
headlight_entity: light.tank300_head
low_beam_entity: light.tank300_low    # 近光（可选）
high_beam_entity: light.tank300_high  # 远光（可选）
taillight_entity: light.tank300_tail
# —— 车窗（binary_sensor，on/open = 开窗玻璃渐隐）——
window_entities:
  lf: binary_sensor.tank300_win_lf
  rf: binary_sensor.tank300_win_rf
  lr: binary_sensor.tank300_win_lr
  rr: binary_sensor.tank300_win_rr
  top: binary_sensor.tank300_sunroof   # 顶窗/天窗（可选）
# —— 胎压 / 胎温 / 油量 ——
show_tpms: true            # 左下角胎压 HUD（俯视轮毂标签始终显示）
show_fuel: true            # 右下角油量 HUD
tpms:
  unit: bar
  lf: sensor.tank300_tpms_lf
  rf: sensor.tank300_tpms_rf
  lr: sensor.tank300_tpms_lr
  rr: sensor.tank300_tpms_rr
  temp:
    lf: sensor.tank300_tire_temp_lf
    rf: sensor.tank300_tire_temp_rf
    lr: sensor.tank300_tire_temp_lr
    rr: sensor.tank300_tire_temp_rr
fuel_entity: sensor.tank300_fuel
# —— 旋转 / 引擎 ——
auto_rotate: false
rotate_speed: 1.2
auto_rotate_entity: input_boolean.tank300_rotate
engine_entity: binary_sensor.tank300_engine   # 运转时车轮转+怠速微震
wheel_speed_entity: sensor.tank300_speed      # 可选：按车速调轮速
wheel_cruise_speed: 60
engine_shake: true
# —— 高级 ——
model: /local/community/ha-car-3d-card/weimingming.glb  # 默认自动查找，一般无需配置
model_rotation: 180        # 模型水平朝向
spotlight: true            # 开灯照亮地面
show_ground: true
bloom_strength: 0.55
bloom_radius: 0.55
bloom_threshold: 1.0
```

## 实体类型说明

| 配置项 | 类型 | 状态含义 |
|---|---|---|
| `door_entities` / `door_lock_entity` | lock / binary_sensor | `unlocked`/`on`/`open` = 门开 |
| `headlight_entity` / `low_beam_entity` / `high_beam_entity` / `taillight_entity` / `light_entity` | light | `on` = 灯亮 |
| `window_entities` / `window_entity` | binary_sensor / cover | `on`/`open` = 开窗（玻璃渐隐） |
| `tpms.*` / `tpms.temp.*` | sensor | 数值 |
| `fuel_entity` | sensor | 0-100 或 0-1 |
| `auto_rotate_entity` | input_boolean | `on` = 自转 |
| `engine_entity` | binary_sensor / sensor | `on` 或数值 > 0 = 运转 |

## 说明

- 默认模型约 44MB，首次加载稍慢，浏览器会缓存
- 模型归一化尺寸：车长按 3.2 单位缩放，车牌/灯位/地面盘均按比例自动定位
- 若模型文件缺失且未配置 `model`，会自动尝试 HACS 目录与 GitHub 备用地址
