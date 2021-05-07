import { FuzzySuggestModal } from "obsidian";
import ObsidianGit from "src/main";
import { FileStatusResult } from "src/types";

export class ChangedFilesModal extends FuzzySuggestModal<FileStatusResult> {
    plugin: ObsidianGit;
    changedFiles: FileStatusResult[];

    constructor(plugin: ObsidianGit, changedFiles: FileStatusResult[]) {
        super(plugin.app);
        this.plugin = plugin;
        this.changedFiles = changedFiles;
        this.setPlaceholder("Not supported files will be opened by default app!");
    }

    getItems(): FileStatusResult[] {
        return this.changedFiles;
    }

    getItemText(item: FileStatusResult): string {
        if ((item as any).working_dir) {
            const simpleItem = item as any;
            if (item.index == "?" && simpleItem.working_dir == "?") {
                return `Untracked | ${item.path}`;
            }

            let working_dir = "";
            let index = "";

            if (simpleItem.working_dir != " ") working_dir = `Working dir: ${simpleItem.working_dir} `;
            if (item.index != " ") index = `Index: ${item.index}`;

            return `${working_dir}${index} | ${item.path}`;
        } else {
            return `${item.index} | ${item.path}`;
        }
    }

    onChooseItem(item: FileStatusResult, _: MouseEvent | KeyboardEvent): void {
        if (this.plugin.app.metadataCache.getFirstLinkpathDest(item.path, "") == null) {
            (this.app as any).openWithDefaultApp(item.path);
        } else {
            this.plugin.app.workspace.openLinkText(item.path, "/");
        }
    }
}