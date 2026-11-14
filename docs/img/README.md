# 截图放这里

指南（`docs/install.html`）里有 7 个虚线占位框，每个框里都写了要拍什么。
按下面的文件名放进来，把占位框换掉即可。

| 文件 | 拍什么 | 大小 |
|---|---|---|
| `step-01.png` | `www.deepseek.com/harness/` 下载页，Mac 版按钮那块 | 16:10 |
| `step-02.png` | 安装窗口，图标拖向 Applications 的瞬间 | 16:10 |
| `step-03.png` | 登录页的微信扫码入口（二维码要完整） | 16:10 |
| `step-04.png` | 对话框：粘贴进去的安装话术 + 发送按钮 | 16:10 |
| `step-05.png` | 建索引时的转圈/进度状态 | 16:10 |
| `step-06.png` | 「索引完成，共 xxx 个文件」那句提示 | 16:10 |
| `step-07.png` | 一次真实问答：问题 + 文件路径 + 页码 | 16:10 |

替换方式：把对应 `<div class="shot">…</div>` 整块换成
`<img src="img/step-01.png" alt="下载页的 Mac 版按钮" style="width:100%;border-radius:10px;border:1px solid var(--rule)">`。

拍之前先把窗口调到大约 1280 宽，文字才不会挤；不要截整屏桌面，只截那个窗口。
