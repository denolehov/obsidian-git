<script lang="ts">
    import { TFile } from "obsidian";
    import { hoverPreview } from "obsidian-community-lib";
    import { FileStatusResult } from "src/types";
    import { getDisplayPath, getNewLeaf } from "src/utils";
    import GitView from "../sourceControl";

    export let change: FileStatusResult;
    export let view: GitView;
    $: side = (view.leaf.getRoot() as any).side == "left" ? "right" : "left";

    function hover(event: MouseEvent) {
        //Don't show previews of config- or hidden files.
        if (app.vault.getAbstractFileByPath(change.vault_path)) {
            hoverPreview(event, view as any, change.vault_path);
        }
    }

    function open(event: MouseEvent) {
        const file = view.app.vault.getAbstractFileByPath(change.vault_path);
        if (file instanceof TFile) {
            getNewLeaf(event)?.openFile(file);
        }
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<main
    on:mouseover={hover}
    on:click|stopPropagation={open}
    on:auxclick|stopPropagation={open}
    on:focus
    class="tree-item nav-file"
>
    <div
        class="tree-item-self is-clickable nav-file-title"
        data-path={change.vault_path}
        data-tooltip-position={side}
        aria-label={change.vault_path}
    >
        <div class="tree-item-inner nav-file-title-content">
            {getDisplayPath(change.vault_path)}
        </div>
        <div class="git-tools">
            <span class="type" data-type={change.working_dir}
                >{change.working_dir}</span
            >
        </div>
    </div>
</main>

<style lang="scss">
    main {
        .nav-file-title {
            align-items: center;
        }
    }
</style>
