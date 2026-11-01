const {
    Plugin,
    setIcon
} = require("obsidian");


module.exports = class TreeCopyButtonPlugin extends Plugin {

    onload() {

        /* 页面已经存在的 Tree 与普通引用 */
        this.addCopyButtons(document);


        /* 监听后续新出现的 Tree 与普通引用 */
        const observer = new MutationObserver((mutations) => {

            for (const mutation of mutations) {

                for (const node of mutation.addedNodes) {

                    if (!(node instanceof HTMLElement)) {
                        continue;
                    }

                    this.addCopyButtons(node);
                }
            }
        });


        observer.observe(document.body, {
            childList: true,
            subtree: true
        });


        /* 插件关闭时停止监听 */
        this.register(() => {
            observer.disconnect();
            document.querySelectorAll(
                '.callout[data-callout="tree"] > .tree-copy-button, ' +
                '.markdown-rendered blockquote > .quote-copy-button'
            ).forEach(button => button.remove());
        });
    }


    /* ========================================================
       给所有 [!tree] 与渲染后的普通引用添加复制按钮
       ======================================================== */

    addCopyButtons(root) {

        const selector = '.callout[data-callout="tree"], ' +
            '.markdown-rendered blockquote:not(.callout)';
        const blocks = [];


        /* root 本身就是目标块 */
        if (
            root instanceof HTMLElement &&
            root.matches(selector)
        ) {
            blocks.push(root);
        }


        /* root 内部存在目标块 */
        if (root.querySelectorAll) {

            blocks.push(
                ...root.querySelectorAll(
                    selector
                )
            );
        }


        for (const block of blocks) {
            const isTree = block.matches('.callout[data-callout="tree"]');
            const buttonClass = isTree ? "tree-copy-button" : "quote-copy-button";
            const label = isTree ? "复制目录树" : "复制引用内容";

            /* 防止重复添加 */
            if (block.querySelector(`:scope > .${buttonClass}`)) {
                continue;
            }


            const button = document.createElement("button");

            button.className = buttonClass;
            button.type = "button";

            button.setAttribute(
                "aria-label",
                label
            );

            button.setAttribute(
                "title",
                label
            );


            /* 使用 Obsidian 自带复制图标 */
            setIcon(button, "copy");


            button.addEventListener(
                "click",
                async (event) => {

                    event.preventDefault();
                    event.stopPropagation();


                    const content =
                        isTree ? block.querySelector(":scope > .callout-content") : block;

                    if (!content) {
                        return;
                    }


                    const text =
                        isTree ? this.getTreeText(content) : content.innerText
                            .replace(/\n{3,}/g, "\n\n")
                            .trim();


                    try {

                        await navigator.clipboard.writeText(text);


                        /* 复制成功 → ✓ */
                        setIcon(button, "check");

                        button.setAttribute(
                            "title",
                            "已复制"
                        );
                        button.setAttribute("aria-label", "已复制");


                        setTimeout(() => {

                            setIcon(button, "copy");

                            button.setAttribute(
                                "title",
                                label
                            );
                            button.setAttribute("aria-label", label);

                        }, 1200);


                    } catch (error) {

                        console.error(
                            "Content copy failed:",
                            error
                        );
                    }
                }
            );


            block.appendChild(button);
        }
    }


    /* ========================================================
       获取 Tree 内容
       ======================================================== */

    getTreeText(content) {

        /*
         * 如果使用的是：
         *
         * - my-project/
         *   - pom.xml
         *   - src/
         *     - main/
         *     - test/
         *
         * 自动转换成：
         *
         * my-project/
         * ├── pom.xml
         * └── src/
         *     ├── main/
         *     └── test/
         */

        const rootList =
            content.querySelector(":scope > ul, :scope > ol");


        if (rootList) {

            return this.convertListToTree(rootList);
        }


        /*
         * 如果还是自己手写：
         *
         * ├──
         * └──
         *
         * 那就直接复制原内容。
         */

        return content.innerText
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }


    /* ========================================================
       Markdown 多级列表 → ASCII Tree
       ======================================================== */

    convertListToTree(rootList) {

        const rootItems =
            this.getDirectItems(rootList);


        if (rootItems.length === 0) {
            return "";
        }


        /*
         * 最常见情况：
         *
         * - my-project/
         *   - pom.xml
         *   - src/
         *
         * my-project 作为根节点，不显示 └──
         */

        if (rootItems.length === 1) {

            const rootItem = rootItems[0];

            const lines = [
                this.getItemText(rootItem)
            ];


            const childList =
                this.getChildList(rootItem);


            if (childList) {

                lines.push(
                    ...this.walkTree(
                        childList,
                        ""
                    )
                );
            }


            return lines.join("\n");
        }


        /*
         * 多个根节点
         */

        return this.walkTree(
            rootList,
            ""
        ).join("\n");
    }


    /* ========================================================
       递归生成 ├── └── │
       ======================================================== */

    walkTree(list, prefix) {

        const items =
            this.getDirectItems(list);

        const lines = [];


        items.forEach((item, index) => {

            const isLast =
                index === items.length - 1;


            const connector =
                isLast
                    ? "└── "
                    : "├── ";


            lines.push(
                prefix +
                connector +
                this.getItemText(item)
            );


            const childList =
                this.getChildList(item);


            if (childList) {

                const childPrefix =
                    prefix +
                    (
                        isLast
                            ? "    "
                            : "│   "
                    );


                lines.push(
                    ...this.walkTree(
                        childList,
                        childPrefix
                    )
                );
            }
        });


        return lines;
    }


    /* ========================================================
       获取 ul / ol 的直接 li
       ======================================================== */

    getDirectItems(list) {

        return Array.from(
            list.children
        ).filter(
            element =>
                element.tagName === "LI"
        );
    }


    /* ========================================================
       获取 li 自己的文字
       排除里面的子 ul / ol
       ======================================================== */

    getItemText(item) {

        const clone =
            item.cloneNode(true);


        clone
            .querySelectorAll("ul, ol")
            .forEach(
                element =>
                    element.remove()
            );


        return clone.innerText
            .replace(/\s+/g, " ")
            .trim();
    }


    /* ========================================================
       获取 li 直接子列表
       ======================================================== */

    getChildList(item) {

        return Array.from(
            item.children
        ).find(
            element =>
                element.tagName === "UL" ||
                element.tagName === "OL"
        );
    }
};
