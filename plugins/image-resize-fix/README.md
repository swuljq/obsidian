# Image Resize Fix v1.1.1

修正版：

- 不再给 `.image-wrapper` 强制 `display:inline-block`，因此不会把后续正文挤到图片右侧。
- 不再扫描/修改所有 `.image-wrapper`，只处理 Markdown 笔记中的原生图片缩放角。
- 直接接管 Obsidian 自带 `.image-resize-corner` 的拖动事件。
- 普通点击图片主体不进入 Lightbox；右上角原生放大按钮仍可使用。
- 松开拖动后将宽度写回 `![[xxx.png|499]]`。
- 缩放时不再覆盖 `image-style.css` 的居中规则，图片不会突然跳到左侧。

安装时直接覆盖旧版 `image-resize-fix` 文件夹，然后重启 Obsidian 或重新加载插件。
