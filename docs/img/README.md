# 截图：现在只需要一张

**只有第 1 步需要真照片**（浏览器打开 `https://www.deepseek.com/harness/` 就能截）。
其余六步用的是**动作示意图**（画在 HTML 里，画的是你要做的动作，不是伪造的 macOS 界面）。

## 必须的（一张）

| 文件 | 拍什么 | 大小 |
|---|---|---|
| `step-01.png` | `www.deepseek.com/harness/` 下载页，Mac 版按钮那一块 | 16:10 |

替换方式：把 `<div class="shot">…</div>` 整块换成

```html
<img src="img/step-01.png" alt="下载页的 Mac 版按钮" style="width:100%;border-radius:10px;border:1px solid var(--rule)">
```

## 以后可选（有真机了再补）

装好之后，如果你从父亲的 Mac 上截到了下面这些，可以替换对应的 `.diagram`：

| 文件 | 拍什么 | 替换对象 |
|---|---|---|
| `step-02.png` | 安装窗口，图标拖向 Applications | `#s2 .diagram` |
| `step-03.png` | 登录页微信扫码入口 | `#s3 .diagram` |
| `step-04.png` | 对话框里的安装话术 | `#s4 .diagram` |
| `step-05.png` | 建索引时的状态 | `#s5 .diagram` |
| `step-06.png` | 「索引完成，共 xxx 个文件」 | `#s6 .diagram` |
| `step-07.png` | 一次真实问答 | `#s7 .diagram` |

**不补也完全能用。** 示意图已经把动作说清楚了；真截图是锦上添花。

## 拍之前

窗口调到约 1280 宽再截，只截那个窗口，别截整个桌面。
