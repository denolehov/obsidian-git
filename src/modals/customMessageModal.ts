import { SuggestModal } from "obsidian";
import ObsidianGit from "src/main";

export class CustomMessageModal extends SuggestModal<string> {
    plugin: ObsidianGit;

    constructor(plugin: ObsidianGit) {
        super(plugin.app);
        this.plugin = plugin;
        this.setPlaceholder("Type your message and select optional the version with the added date.");
    }


    getSuggestions(query: string): string[] {
        const date = (window as any).moment().format(this.plugin.settings.commitDateFormat);
        if (query == "") query = "...";
        return [query, `${date}: ${query}`, `${query}: ${date}`];
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.innerText = value;
    }

    onChooseSuggestion(item: string, _: MouseEvent | KeyboardEvent): void {
        this.plugin.promiseQueue.addTask(() => this.plugin.createBackup(false, item));
    }

}