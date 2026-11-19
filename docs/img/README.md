# 配图说明

两份指南共用同一套图和样式：

| 源文件 | 单文件版 |
|---|---|
| `docs/install-universal.html` | `docs/install-universal-standalone.html` |
| `docs/install-windows.html` | `docs/install-windows-standalone.html` |

改完源文件后重跑对应那条：

```bash
node scripts/bundle-guide.mjs
node scripts/bundle-guide.mjs --source install-windows.html --out install-windows-standalone.html
```

测试会比对，忘了跑就报 stale。

> 为什么要有单文件版：只发 HTML 不带 `img/` 文件夹时，相对路径全部失效——手机上就是「图片不显示」。内嵌后一个文件到哪都能开。

## 两张真图

两张都从同一张官网截图裁出来，用脚本生成，不要手工裁：

```bash
python scripts/crop-guide-images.py <官网截图.png>
```

| 文件 | 用在哪 | 内容 | 尺寸 |
|---|---|---|---|
| `hero-shot.png` | 页首右侧的「产品肖像」 | 官网整页：标题 + 下载按钮 + 一点产品窗口 | 2533×1583 |
| `step-01-menu.png` | 第 1 步正文里 | 下载按钮本身，含右侧箭头 | 880×180 |

换新截图时，重新量一下按钮在源图里的位置，改 `scripts/crop-guide-images.py` 里的 `BUTTON` 就行。

## 六个示意图（不占图片文件）

第 2–7 步的图是内联 SVG，画的是**读者要做的动作**，不是伪造的系统界面。
改文案或改图形都直接改对应源页面里的 `<svg>`。

## 以后可选：换成真截图

有了真机截图，可以把对应 `<div class="plate">…<svg>…</svg></div>` 整块换成：

```html
<div class="plate"><img src="img/step-02.png" alt="安装窗口，图标拖向应用程序文件夹"></div>
```

然后重跑 `node scripts/bundle-guide.mjs`。不换也完全能用。

## 拍之前

窗口调到约 1280 宽再截，只截那个窗口。

**截图里不许出现任何个人信息**：桌面图标、文件名、用户名、浏览器标签页、通知都要避开或裁掉。
这两张图会随公开仓库发布，截图前先确认画面里只有一个产品界面。
