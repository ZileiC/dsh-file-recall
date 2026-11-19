# 配图说明

两份指南各有各的图，互不覆盖：

| 指南 | 源文件 | 单文件版 | 图 |
|---|---|---|---|
| macOS | `docs/install-universal.html` | `docs/install-universal-standalone.html` | `hero-shot.png`、`step-01-menu.png` |
| Windows | `docs/install-windows.html` | `docs/install-windows-standalone.html` | `windows-page.png`、`windows-button.png` |

改完源文件后重跑对应那条：

```bash
node scripts/bundle-guide.mjs
node scripts/bundle-guide.mjs --source install-windows.html --out install-windows-standalone.html
```

测试会比对，忘了跑就报 stale。

> 为什么要有单文件版：只发 HTML 不带 `img/` 文件夹时，相对路径全部失效——手机上就是「图片不显示」。内嵌后一个文件到哪都能开。

## 真图

| 文件 | 用在 | 内容 | 尺寸 |
|---|---|---|---|
| `hero-shot.png` | macOS 页首 | 官网整页，下载菜单展开，第一项是 macOS | 1318×823 |
| `step-01-menu.png` | macOS 第 1 步 | 展开菜单的特写 | 896×560 |
| `windows-page.png` | Windows 页首 | 官网整页，按钮上写 Download for Windows | 2533×1583 |
| `windows-button.png` | Windows 第 1 步 | 下载按钮，含右侧箭头，菜单收起 | 880×180 |

Windows 那两张用脚本从一张新截图裁出来：

```bash
python scripts/crop-guide-images.py <官网截图.png>
```

换截图时重新量一下按钮在源图里的位置，改脚本里的 `BUTTON` 即可。

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
