import { App } from "obsidian";
import ObsidianGit from "../main";
import {
    BranchInfo,
    DiffFile,
    FileStatusResult,
    LogEntry,
    Status,
    TreeItem,
    UnstagedFile,
} from "../types";

export abstract class GitManager {
    readonly plugin: ObsidianGit;
    readonly app: App;
    constructor(plugin: ObsidianGit) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    abstract status(): Promise<Status>;

    abstract commitAll(_: {
        message: string;
        status?: Status;
        unstagedFiles?: UnstagedFile[];
        amend?: boolean;
    }): Promise<number | undefined>;

    abstract commit(_: {
        message: string;
        amend?: boolean;
    }): Promise<number | undefined>;

    abstract stageAll(_: { dir?: string; status?: Status }): Promise<void>;

    abstract unstageAll(_: { dir?: string; status?: Status }): Promise<void>;

    abstract stage(filepath: string, relativeToVault: boolean): Promise<void>;

    abstract unstage(filepath: string, relativeToVault: boolean): Promise<void>;

    abstract discard(filepath: string): Promise<void>;

    abstract discardAll(_: { dir?: string; status?: Status }): Promise<void>;

    abstract pull(): Promise<FileStatusResult[] | undefined>;

    abstract push(): Promise<number | undefined>;

    abstract getUnpushedCommits(): Promise<number>;

    abstract canPush(): Promise<boolean>;

    abstract checkRequirements(): Promise<
        "valid" | "missing-repo" | "missing-git"
    >;

    abstract branchInfo(): Promise<BranchInfo>;

    abstract checkout(branch: string, remote?: string): Promise<void>;

    abstract createBranch(branch: string): Promise<void>;

    abstract deleteBranch(branch: string, force: boolean): Promise<void>;

    abstract branchIsMerged(branch: string): Promise<boolean>;

    abstract init(): Promise<void>;

    abstract clone(url: string, dir: string, depth?: number): Promise<void>;

    abstract setConfig(
        path: string,
        value: string | number | boolean | undefined
    ): Promise<void>;

    abstract getConfig(path: string): Promise<any>;

    abstract fetch(remote?: string): Promise<void>;

    abstract setRemote(name: string, url: string): Promise<void>;

    abstract getRemotes(): Promise<string[]>;

    abstract getRemoteUrl(remote: string): Promise<string | undefined>;

    abstract log(
        file: string | undefined,
        relativeToVault?: boolean,
        limit?: number
    ): Promise<LogEntry[]>;

    abstract getRemoteBranches(remote: string): Promise<string[]>;

    abstract removeRemote(remoteName: string): Promise<void>;

    abstract updateUpstreamBranch(remoteBranch: string): Promise<void>;

    abstract updateGitPath(gitPath: string): void;

    abstract updateBasePath(basePath: string): void;

    abstract getDiffString(
        filePath: string,
        stagedChanges: boolean,
        hash?: string
    ): Promise<string>;

    abstract getLastCommitTime(): Promise<Date | undefined>;

    // Constructs a path relative to the vault from a path relative to the git repository
    getRelativeVaultPath(path: string): string {
        if (this.plugin.settings.basePath) {
            return this.plugin.settings.basePath + "/" + path;
        } else {
            return path;
        }
    }

    // Constructs a path relative to the git repository from a path relative to the vault
    //
    // @param doConversion - If false, the path is returned as is. This is added because that parameter is often passed on to functions where this method is called.
    getRelativeRepoPath(path: string, doConversion: boolean = true): string {
        if (doConversion) {
            if (this.plugin.settings.basePath.length > 0) {
                return path.substring(this.plugin.settings.basePath.length + 1);
            }
        }
        return path;
    }
    abstract getAICommitSummary(): Promise<string>
    private _getTreeStructure<T = DiffFile | FileStatusResult>(
        children: (T & { path: string })[],
        beginLength = 0
    ): TreeItem<T>[] {
        const list: TreeItem<T>[] = [];
        children = [...children];
        while (children.length > 0) {
            const first = children.first()!;
            const restPath = first.path.substring(beginLength);
            if (restPath.contains("/")) {
                const title = restPath.substring(0, restPath.indexOf("/"));
                const childrenWithSameTitle = children.filter((item) => {
                    return item.path
                        .substring(beginLength)
                        .startsWith(title + "/");
                });
                childrenWithSameTitle.forEach((item) => children.remove(item));
                const path = first.path.substring(
                    0,
                    restPath.indexOf("/") + beginLength
                );
                list.push({
                    title: title,
                    path: path,
                    vaultPath: this.getRelativeVaultPath(path),
                    children: this._getTreeStructure(
                        childrenWithSameTitle,
                        (beginLength > 0
                            ? beginLength + title.length
                            : title.length) + 1
                    ),
                });
            } else {
                list.push({
                    title: restPath,
                    data: first,
                    path: first.path,
                    vaultPath: this.getRelativeVaultPath(first.path),
                });
                children.remove(first);
            }
        }
        return list;
    }

    /*
     * Sorts the children and simplifies the title
     * If a node only contains another subdirectory, that subdirectory is moved up one level and integrated into the parent node
     */
    private simplify<T>(tree: TreeItem<T>[]): TreeItem<T>[] {
        for (const node of tree) {
            while (true) {
                const singleChild = node.children?.length == 1;
                const singleChildIsDir =
                    node.children?.first()?.data == undefined;

                if (
                    !(
                        node.children != undefined &&
                        singleChild &&
                        singleChildIsDir
                    )
                )
                    break;
                const child = node.children.first()!;
                node.title += "/" + child.title;
                node.data = child.data;
                node.path = child.path;
                node.vaultPath = child.vaultPath;
                node.children = child.children;
            }
            if (node.children != undefined) {
                this.simplify<T>(node.children);
            }
            node.children?.sort((a, b) => {
                const dirCompare =
                    (b.data == undefined ? 1 : 0) -
                    (a.data == undefined ? 1 : 0);
                if (dirCompare != 0) {
                    return dirCompare;
                } else {
                    return a.title.localeCompare(b.title);
                }
            });
        }
        return tree.sort((a, b) => {
            const dirCompare =
                (b.data == undefined ? 1 : 0) - (a.data == undefined ? 1 : 0);
            if (dirCompare != 0) {
                return dirCompare;
            } else {
                return a.title.localeCompare(b.title);
            }
        });
    }

    getTreeStructure<T = DiffFile | FileStatusResult>(
        children: (T & { path: string })[]
    ): TreeItem<T>[] {
        const tree = this._getTreeStructure<T>(children);

        const res = this.simplify<T>(tree);
        return res;
    }

    async formatCommitMessage(template: string): Promise<string> {
        let status: Status | undefined;
        if (template.includes("{{numFiles}}")) {
            status = await this.status();
            const numFiles = status.staged.length;
            template = template.replace("{{numFiles}}", String(numFiles));
        }
        if (template.includes("{{hostname}}")) {
            const hostname = this.plugin.localStorage.getHostname() || "";
            template = template.replace("{{hostname}}", hostname);
        }
        if (template.includes("{{ai_summary}}")) {
            const ai_summary = await this.getAICommitSummary() || "";
            template = template.replace("{{ai_summary}}", ai_summary);
        }

        if (template.includes("{{files}}")) {
            status = status ?? (await this.status());

            const changeset: { [key: string]: string[] } = {};
            status.staged.forEach((value: FileStatusResult) => {
                if (value.index in changeset) {
                    changeset[value.index].push(value.path);
                } else {
                    changeset[value.index] = [value.path];
                }
            });

            const chunks = [];
            for (const [action, files] of Object.entries(changeset)) {
                chunks.push(action + " " + files.join(" "));
            }

            const files = chunks.join(", ");

            template = template.replace("{{files}}", files);
        }

        const moment = (window as any).moment;
        template = template.replace(
            "{{date}}",
            moment().format(this.plugin.settings.commitDateFormat)
        );
        if (this.plugin.settings.listChangedFilesInMessageBody) {
            template =
                template +
                "\n\n" +
                "Affected files:" +
                "\n" +
                (status ?? (await this.status())).staged
                    .map((e) => e.path)
                    .join("\n");
        }
        return template;
    }
}
