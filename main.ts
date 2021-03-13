import { Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import simpleGit, { CheckRepoActions, SimpleGit } from "simple-git";
import { FileStatusResult } from "simple-git/typings/response";

enum PluginState {
    idle,
    status,
    pull,
    add,
    commit,
    push,
}

export default class ObsidianGit extends Plugin {
    public git: SimpleGit;
    public settings: ObsidianGitSettings;
    public statusBar: StatusBar;
    public state: PluginState = PluginState.idle;
    public intervalID: number;
    public lastUpdate: number;

    setState(state: PluginState) {
        this.state = state;
        this.statusBar.display();
    }

    getState(): PluginState {
        return this.state;
    }

    async onload() {
        let statusBarEl = this.addStatusBarItem();
        this.statusBar = new StatusBar(statusBarEl, this);
        this.setState(PluginState.idle);
        this.registerInterval(
            window.setInterval(() => this.statusBar.display(), 1000)
        );

        const adapter: any = this.app.vault.adapter;
        const git = simpleGit(adapter.basePath);

        let isValidRepo = git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
        if (!isValidRepo) {
            this.displayMessage("Valid git repository not found.", 0);
            return;
        }

        this.git = git;
        this.settings = (await this.loadData()) || new ObsidianGitSettings();

        // resolve current branch and remote
        let branchInfo = await git.branch();
        this.settings.currentBranch = branchInfo.current;

        if (this.settings.autoPullOnBoot) {
            await this.pull().then((filesUpdated) => {
                this.setState(PluginState.idle);
                let message =
                    filesUpdated > 0
                        ? `Pulled new changes. ${filesUpdated} files updated`
                        : "Everything up-to-date";
                this.displayMessage(message);
            });
        }

        if (this.settings.autoSaveInterval > 0) {
            this.enableAutoBackup();
        }

        this.addSettingTab(new ObsidianGitSettingsTab(this.app, this));

        this.addCommand({
            id: "pull",
            name: "Pull from remote repository",
            callback: async () => this.pullChangesFromRemote(),
        });

        this.addCommand({
            id: "push",
            name: "Commit *all* changes and push to remote repository",
            callback: async () =>
                await this.getFilesChanged().then(async (files) => {
                    if (!files.length) {
                        this.displayMessage("No changes detected");
                        this.setState(PluginState.idle);
                        return;
                    }

                    await this.createBackup();
                }),
        });
    }

    async pullChangesFromRemote() {
        await this.pull().then((filesUpdated) => {
            if (filesUpdated > 0) {
                this.displayMessage(
                    `Pulled new changes. ${filesUpdated} files updated`
                );
            } else {
                this.displayMessage("Everything is up-to-date");
            }
        });

        this.lastUpdate = Date.now();
        this.setState(PluginState.idle);
    }

    async createBackup() {
        await this.getFilesChanged().then(async (files) => {
            if (files.length === 0) {
                this.setState(PluginState.idle);
                return;
            }

            await this.add()
                .then(async () => await this.commit())
                .then(() =>
                    this.displayMessage(`Committed ${files.length} files`)
                );

            if (!this.settings.disablePush) {
                await this.push().then(() =>
                    this.displayMessage(
                        `Pushed ${files.length} files to remote`
                    )
                );
            }
        });

        this.lastUpdate = Date.now();
        this.setState(PluginState.idle);
    }

    async onunload() {
        await this.saveData(this.settings);
    }

    // region: main methods
    async getFilesChanged(): Promise<FileStatusResult[]> {
        this.setState(PluginState.status);
        let status = await this.git.status();
        return status.files;
    }

    async add(): Promise<void> {
        this.setState(PluginState.add);
        await this.git.add(
            "./*",
            (err: Error | null) =>
                err && this.displayError(`Cannot add files: ${err.message}`)
        );
    }

    async commit(): Promise<void> {
        this.setState(PluginState.commit);
        let commitMessage = await this.formatCommitMessage(
            this.settings.commitMessage
        );
        await this.git.commit(commitMessage);
    }

    async push(): Promise<void> {
        this.setState(PluginState.push);
        await this.git.push(
            this.settings.remote,
            this.settings.currentBranch,
            null,
            (err: Error | null) => {
                err && this.displayError(`Push failed ${err.message}`);
            }
        );

        this.lastUpdate = Date.now();
    }

    async pull(): Promise<number> {
        this.setState(PluginState.pull);
        let pullResult = await this.git.pull(
            null,
            null,
            null,
            (err: Error | null) =>
                err && this.displayError(`Pull failed ${err.message}`)
        );
        this.lastUpdate = Date.now();
        return pullResult.files.length;
    }

    // endregion: main methods

    enableAutoBackup() {
        let minutes = this.settings.autoSaveInterval;
        this.intervalID = window.setInterval(
            async () => await this.createBackup(),
            minutes * 60000
        );
        this.registerInterval(this.intervalID);
    }

    disableAutoBackup(): boolean {
        if (this.intervalID) {
            clearInterval(this.intervalID);
            return true;
        }

        return false;
    }

    // region: displaying / formatting messages
    displayMessage(message: string, timeout: number = 4 * 1000): void {
        this.statusBar.displayMessage(message.toLowerCase(), timeout);

        if (!this.settings.disablePopups) {
            new Notice(message);
        }

        console.log(`git obsidian: ${message}`);
    }

    displayError(message: string, timeout: number = 0): void {
        new Notice(message);
        this.statusBar.displayMessage(message.toLowerCase(), timeout);
    }

    async formatCommitMessage(template: string): Promise<string> {
        if (template.includes("{{numFiles}}")) {
            let status = await this.git.status();
            let numFiles = status.files.length;
            template = template.replace("{{numFiles}}", String(numFiles));
        }

        if (template.includes("{{files}}")) {
            let status = await this.git.status();

            let changeset: { [key: string]: string[] } = {};
            status.files.forEach((value: FileStatusResult) => {
                if (value.index in changeset) {
                    changeset[value.index].push(value.path);
                } else {
                    changeset[value.index] = [value.path];
                }
            });

            let chunks = [];
            for (let [action, files] of Object.entries(changeset)) {
                chunks.push(action + " " + files.join(" "));
            }

            let files = chunks.join(", ");

            template = template.replace("{{files}}", files);
        }

        let moment = (window as any).moment;
        return template.replace(
            "{{date}}",
            moment().format(this.settings.commitDateFormat)
        );
    }

    // endregion: displaying / formatting stuff
}

class ObsidianGitSettings {
    commitMessage: string = "vault backup: {{date}}";
    commitDateFormat: string = "YYYY-MM-DD HH:mm:ss";
    autoSaveInterval: number = 0;
    autoPullOnBoot: boolean = false;
    disablePush: boolean = true;
    disablePopups: boolean = false;
    currentBranch: string;
    remote: string = "origin";
}

class ObsidianGitSettingsTab extends PluginSettingTab {
    display(): void {
        let { containerEl } = this;
        const plugin: ObsidianGit = (this as any).plugin;

        containerEl.empty();
        containerEl.createEl("h2", { text: "Git Backup settings" });

        new Setting(containerEl)
            .setName("Vault backup interval (minutes)")
            .setDesc(
                "Commit and push changes every X minutes. To disable automatic backup, specify negative value or zero (default)"
            )
            .addText((text) =>
                text
                    .setValue(String(plugin.settings.autoSaveInterval))
                    .onChange((value) => {
                        if (!isNaN(Number(value))) {
                            plugin.settings.autoSaveInterval = Number(value);
                            plugin.saveData(plugin.settings);

                            if (plugin.settings.autoSaveInterval > 0) {
                                plugin.disableAutoBackup(); // call clearInterval() before setting up a new one
                                plugin.enableAutoBackup();
                                new Notice(
                                    `Automatic backup enabled! Every ${plugin.settings.autoSaveInterval} minutes.`
                                );
                            } else if (
                                plugin.settings.autoSaveInterval <= 0 &&
                                plugin.intervalID
                            ) {
                                plugin.disableAutoBackup() &&
                                    new Notice("Automatic backup disabled!");
                            }
                        } else {
                            new Notice("Please specify a valid number.");
                        }
                    })
            );

        new Setting(containerEl)
            .setName("Commit message")
            .setDesc(
                "Specify custom commit message. Available placeholders: {{date}}" +
                " (see below) and {{numFiles}} (number of changed files in the commit)"
            )
            .addText((text) =>
                text
                    .setPlaceholder("vault backup")
                    .setValue(
                        plugin.settings.commitMessage
                            ? plugin.settings.commitMessage
                            : ""
                    )
                    .onChange((value) => {
                        plugin.settings.commitMessage = value;
                        plugin.saveData(plugin.settings);
                    })
            );

        new Setting(containerEl)
            .setName("{{date}} placeholder format")
            .setDesc('Specify custom date format. E.g. "YYYY-MM-DD HH:mm:ss"')
            .addText((text) =>
                text
                    .setPlaceholder(plugin.settings.commitDateFormat)
                    .setValue(plugin.settings.commitDateFormat)
                    .onChange(async (value) => {
                        plugin.settings.commitDateFormat = value;
                        await plugin.saveData(plugin.settings);
                    })
            );

        new Setting(containerEl)
            .setName("Preview commit message")
            .addButton((button) =>
                button.setButtonText("Preview").onClick(async () => {
                    let commitMessagePreview = await plugin.formatCommitMessage(
                        plugin.settings.commitMessage
                    );
                    new Notice(`${commitMessagePreview}`);
                })
            );

        new Setting(containerEl)
            .setName("Current branch")
            .setDesc("Switch to a different branch")
            .addDropdown(async (dropdown) => {
                let branchInfo = await plugin.git.branchLocal();
                for (const branch of branchInfo.all) {
                    dropdown.addOption(branch, branch);
                }
                dropdown.setValue(branchInfo.current);
                dropdown.onChange(async (option) => {
                    await plugin.git.checkout(
                        option,
                        [],
                        async (err: Error) => {
                            if (err) {
                                new Notice(err.message);
                                dropdown.setValue(branchInfo.current);
                            } else {
                                new Notice(`Checked out to ${option}`);
                                plugin.settings.currentBranch = option;
                                await plugin.saveData(plugin.settings);
                            }
                        }
                    );
                });
            });

        new Setting(containerEl)
            .setName("Remote")
            .setDesc("Git remote for push")
            .addText((text) =>
                text
                    .setPlaceholder(plugin.settings.remote)
                    .setValue(plugin.settings.remote)
                    .onChange(async (value) => {
                        plugin.settings.remote = value;
                        await plugin.saveData(plugin.settings);
                    })
            );

        new Setting(containerEl)
            .setName("Pull updates on startup")
            .setDesc("Automatically pull updates when Obsidian starts")
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.autoPullOnBoot)
                    .onChange((value) => {
                        plugin.settings.autoPullOnBoot = value;
                        plugin.saveData(plugin.settings);
                    })
            );

        new Setting(containerEl)
            .setName("Disable push")
            .setDesc("Do not push changes to the remote repository")
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.disablePush)
                    .onChange((value) => {
                        plugin.settings.disablePush = value;
                        plugin.saveData(plugin.settings);
                    })
            );

        new Setting(containerEl)
            .setName("Disable notifications")
            .setDesc(
                "Disable notifications for git operations to minimize distraction (refer to status bar for updates)"
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.disablePopups)
                    .onChange((value) => {
                        plugin.settings.disablePopups = value;
                        plugin.saveData(plugin.settings);
                    })
            );
    }
}

interface StatusBarMessage {
    message: string;
    timeout: number;
}

class StatusBar {
    public messages: StatusBarMessage[] = [];
    public currentMessage: StatusBarMessage;
    public lastMessageTimestamp: number;

    private statusBarEl: HTMLElement;
    private plugin: ObsidianGit;

    constructor(statusBarEl: HTMLElement, plugin: ObsidianGit) {
        this.statusBarEl = statusBarEl;
        this.plugin = plugin;
    }

    public displayMessage(message: string, timeout: number) {
        this.messages.push({
            message: `git: ${message.slice(0, 100)}`,
            timeout: timeout,
        });
        this.display();
    }

    public display() {
        if (this.messages.length > 0 && !this.currentMessage) {
            this.currentMessage = this.messages.shift();
            this.statusBarEl.setText(this.currentMessage.message);
            this.lastMessageTimestamp = Date.now();
        } else if (this.currentMessage) {
            let messageAge = Date.now() - this.lastMessageTimestamp;
            if (messageAge >= this.currentMessage.timeout) {
                this.currentMessage = null;
                this.lastMessageTimestamp = null;
            }
        } else {
            this.displayState();
        }
    }

    private displayState() {
        let state = this.plugin.getState();

        switch (state) {
            case PluginState.idle:
                this.displayFromNow(this.plugin.lastUpdate);
                break;
            case PluginState.status:
                this.statusBarEl.setText("git: checking repo status..");
                break;
            case PluginState.add:
                this.statusBarEl.setText("git: adding files to repo..");
                break;
            case PluginState.commit:
                this.statusBarEl.setText("git: committing changes..");
                break;
            case PluginState.push:
                this.statusBarEl.setText("git: pushing changes..");
                break;
            case PluginState.pull:
                this.statusBarEl.setText("git: pulling changes..");
                break;
        }
    }

    private displayFromNow(timestamp: number): void {
        if (timestamp) {
            let moment = (window as any).moment;
            let fromNow = moment(timestamp).fromNow();
            this.statusBarEl.setText(`git: last update ${fromNow}..`);
        } else {
            this.statusBarEl.setText(`git: ready`);
        }
    }
}
