# HA Car 3D Card · 3D 汽车展示卡片

适用于 [Home Assistant](https://www.home-assistant.io/) 的 Lovelace 3D 汽车卡片：加载 GLB 模型实时渲染，车门/车灯/车窗与 HA 实体联动，支持点击车身切换俯视视角查看四轮胎压与温度。

> 演示模型为坦克 300（侧开尾门备胎版），内置完整车漆、内饰、灯光材质修正。

## 功能特性

- **3D 渲染**：Three.js + PMREM 环境反射 + ACES 色调映射 + UnrealBloom 泛光，车漆/玻璃/金属质感真实
- **5 门独立开关**：四个车门 + 侧开式尾门，全部绕垂直轴开合（车门向外开），角度可在 YAML 配置
- **车灯物理泛光**：大灯/尾灯独立实体控制，灯体 emissive 过曝 + Bloom 泛光 + SpotLight 地面照明，无贴图假光
- **车牌生成**：Canvas 绘制蓝牌/绿牌（新能源），前牌大灯之间、后牌保险杠牌照位，位置/微旋角可调
- **车窗联动**：门玻璃随车窗实体开/关渐变透明，其余玻璃微暗、前挡高透
- **胎压 + 温度**：左下角 HUD 常显四轮胎压；点击车身进入俯视后，轮毂处浮出胎压+温度标签
- **俯视模式**：点击车身一键切换车尾正上方俯视（车头朝上），俯视下强制停止自转；再点恢复
- **自动旋转**：默认开关 + 旋转速度可配，可绑定 HA 实体远程控制
- **油量显示**：油量实体 + 渐变色进度条
- **可视化编辑器**：HA 卡片编辑界面直接配置标题、车牌、背景色、自动旋转等常用项，无需写 YAML

## 安装

### 方式一：HACS（推荐）

1. HACS → 前端 → 右上角 ⋯ → 自定义存储库
2. 添加本仓库地址，类别选择 **Lovelace**
3. 在 HACS 中搜索 "Car 3D" 安装

### 方式二：手动安装

将仓库内所有文件复制到 HA 配置目录：

```
config/www/car3d/
```

然后在仪表盘资源中添加（或编辑 `.storage/lovelace_resources`）：

```yaml
url: /local/car3d/car-3d-card.js
type: module
```

## 快速开始

```yaml
type: custom:car-3d-card
title: 坦克 300
plate_number: 甘M·DM815
plate_type: blue
bg_color: '#0e0e0e'
auto_rotate: false
rotate_speed: 1.0
height: 400
```

> HACS 安装路径为 `/local/community/ha-car-3d-card`，需追加：
> ```yaml
> base: /local/community/ha-car-3d-card
> model: /local/community/ha-car-3d-card/weimingming.glb
> ```

## 实体绑定

```yaml
type: custom:car-3d-card
plate_number: 甘M·DM815

# 车门（短键/长键均可，state: on/open/unlocked = 开）
door_entities:
  lf: binary_sensor.car_door_lf    # 或 lf_door
  rf: binary_sensor.car_door_rf
  lr: binary_sensor.car_door_lr
  rr: binary_sensor.car_door_rr
  trunk: binary_sensor.car_trunk

# 单一门锁实体（未配置单独门实体时，解锁=全车门开）
door_lock_entity: lock.car_door

# 车灯
headlight_entity: light.car_headlight
taillight_entity: light.car_taillight
light_entity: light.car_light      # 大小灯共用时配置（优先级低于上面两个）

# 车窗（仅影响四个车门玻璃）
window_entity: binary_sensor.car_window

# 胎压 + 温度（温度读 state 或 temperature 属性）
tpms:
  lf: sensor.tire_lf_pressure
  rf: sensor.tire_rf_pressure
  lr: sensor.tire_lr_pressure
  rr: sensor.tire_rr_pressure
  unit: bar
  temp:
    lf: sensor.tire_lf_temp
    rf: sensor.tire_rf_temp
    lr: sensor.tire_lr_temp
    rr: sensor.tire_rr_temp

# 油量（state 为百分比数值）
fuel_entity: sensor.car_fuel

# 自动旋转开关实体（按钮远程控制自转）
auto_rotate_entity: input_boolean.car_rotate
```

## 全部配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `base` | `/local/car3d` | three.js 等资源所在 URL 路径 |
| `model` | `{base}/weimingming.glb` | GLB 模型地址 |
| `title` | 空 | 卡片标题（空则不显示） |
| `height` | `400` | 卡片高度（px） |
| `bg_color` | `#0e0e0e` | 背景颜色 |
| `plate_number` | 空 | 车牌号（空则不显示车牌） |
| `plate_type` | `blue` | 车牌颜色：`blue` 蓝牌 / `green` 绿牌 |
| `plate_height` | `0.34` | 前牌离地高度（占车高比例） |
| `plate_rear` | 见源码 | 后牌定位 `{front, side, height, tilt}`，tilt 为绕竖轴微旋角 |
| `auto_rotate` | `false` | 默认自动旋转 |
| `rotate_speed` | `1.0` | 旋转速度 |
| `auto_rotate_entity` | 空 | 自转控制实体 |
| `door_angle` | `62` | 车门开合角度（度） |
| `trunk_angle` | `75` | 尾门开合角度（度） |
| `door_entities` | 空 | 5 门实体映射 |
| `door_lock_entity` | 空 | 门锁实体 |
| `headlight_entity` / `taillight_entity` / `light_entity` | 空 | 车灯实体 |
| `window_entity` | 空 | 车窗实体 |
| `tpms` | 空 | 胎压/温度实体映射 + `unit` |
| `fuel_entity` | 空 | 油量实体 |
| `light_color` | `#fff2cc` | 大灯颜色 |
| `headlight_pos` / `taillight_pos` | 见源码 | 灯位比例定位 `{front, side, height}` |
| `spotlight` | `true` | 开灯时照亮地面 |
| `bloom_strength` | `0.55` | 泛光强度 |
| `bloom_radius` | `0.55` | 泛光羽化半径 |
| `bloom_threshold` | `1.0` | 泛光阈值 |
| `model_rotation` | `180` | 模型水平朝向（度） |
| `model_fix_roll` | `-90` | 模型姿态修正（度） |
| `show_ground` | `true` | 显示地面 |
| `wheel_spin` | `false` | 车轮持续自转（展示用） |

## 交互

- **拖动**：旋转视角 / 滚轮缩放
- **点击车身**：切换俯视 ↔ 原视角（俯视下车头朝上、轮毂处显示胎压温度、强制停转）

## 使用自己的模型

替换 `model` 指向你的 GLB。模型需为 **Y-up** 且车门铰链符合以下节点名（坦克 300 IFC 导出结构）：

- 车门铰链：`Dummy001`~`Dummy005`（左前/左后/尾门/右前/右后）、尾门附加 `Dummy010`
- 车轮：`Dummy006`/`Dummy007`
- 车门玻璃：`26_lf_door_glass` 等

其他模型需在源码 `DOOR_DUMMIES`/`DOOR_GLASS`/`WHEEL_DUMMIES` 名单中适配节点名。

## 致谢

- [Three.js](https://threejs.org/) r162
- 演示模型取自懂车帝坦克 300 车型页

## License

MIT
