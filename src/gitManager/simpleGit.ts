import { spawnSync } from "child_process";
import debug from "debug";
import { FileSystemAdapter, normalizePath, Notice } from "obsidian";
import * as path from "path";
import { sep, resolve } from "path";
import simpleGit, * as simple from "simple-git";
import { GIT_LINE_AUTHORING_MOVEMENT_DETECTION_MINIMAL_LENGTH } from "src/constants";
import { LineAuthorFollowMovement } from "src/lineAuthor/model";
import ObsidianGit from "../main";
import {
    Blame,
    BlameCommit,
    BranchInfo,
    FileStatusResult,
    LogEntry,
    PluginState,
    Status,
} from "../types";
import { impossibleBranch, splitRemoteBranch } from "../utils";
import { GitManager } from "./gitManager";

export class SimpleGit extends GitManager {
    git: simple.SimpleGit;
    constructor(plugin: ObsidianGit) {
        super(plugin);
    }

    async setGitInstance(ignoreError = false): Promise<void> {
        if (this.isGitInstalled()) {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            const path = adapter.getBasePath();
            let basePath = path;
            // Because the basePath setting is a relative path, a leading `/` must
            // be appended before concatenating with the path.
            if (this.plugin.settings.basePath) {
                const exists = await adapter.exists(
                    normalizePath(this.plugin.settings.basePath)
                );
                if (exists) {
                    basePath = path + sep + this.plugin.settings.basePath;
                } else if (!ignoreError) {
                    new Notice("ObsidianGit: Base path does not exist");
                }
            }

            this.git = simpleGit({
                baseDir: basePath,
                binary: this.plugin.localStorage.getGitPath() || undefined,
                config: ["core.quotepath=off"],
            });
            const pathPaths = this.plugin.localStorage.getPATHPaths();
            const envVars = this.plugin.localStorage.getEnvVars();
            const gitDir = this.plugin.settings.gitDir;
            if (pathPaths.length > 0) {
                const path = process.env["PATH"] + ":" + pathPaths.join(":");
                process.env["PATH"] = path;
            }
            if (gitDir) {
                process.env["GIT_DIR"] = gitDir;
            }
            for (const envVar of envVars) {
                const [key, value] = envVar.split("=");
                process.env[key] = value;
            }

            debug.enable("simple-git");
            if (await this.git.checkIsRepo()) {
                // Resolve the relative root reported by git into an absolute path
                // in case git resides in a different filesystem (eg, WSL)
                const relativeRoot = await this.git.revparse("--show-cdup");
                const absoluteRoot = resolve(basePath + sep + relativeRoot);
                await this.git.cwd(absoluteRoot);
            }
        }
    }

    async status(): Promise<Status> {
        this.plugin.setState(PluginState.status);
        const status = await this.git.status((err) => this.onError(err));
        this.plugin.setState(PluginState.idle);

        const allFilesFormatted = status.files.map<FileStatusResult>((e) => {
            const res = this.formatPath(e);
            return {
                path: res.path,
                from: res.from,
                index: e.index === "?" ? "U" : e.index,
                working_dir: e.working_dir === "?" ? "U" : e.working_dir,
                vault_path: this.getRelativeVaultPath(res.path),
            };
        });
        return {
            all: allFilesFormatted,
            changed: allFilesFormatted.filter((e) => e.working_dir !== " "),
            staged: allFilesFormatted.filter(
                (e) => e.index !== " " && e.index != "U"
            ),
            conflicted: status.conflicted.map(
                (path) => this.formatPath({ path }).path
            ),
        };
    }

    async submoduleAwareHeadRevisonInContainingDirectory(
        filepath: string
    ): Promise<string> {
        const repoPath = this.getRelativeRepoPath(filepath);

        const containingDirectory = path.dirname(repoPath);
        const args = ["-C", containingDirectory, "rev-parse", "HEAD"];

        const result = this.git.raw(args);
        result.catch((err) =>
            console.warn("obsidian-git: rev-parse error:", err)
        );
        return result;
    }

    async getSubmodulePaths(): Promise<string[]> {
        return new Promise<string[]>(async (resolve) => {
            this.git.outputHandler(async (cmd, stdout, stderr, args) => {
                // Do not run this handler on other commands
                if (!(args.contains("submodule") && args.contains("foreach"))) {
                    return;
                }

                let body = "";
                const root =
                    (
                        this.app.vault.adapter as FileSystemAdapter
                    ).getBasePath() +
                    (this.plugin.settings.basePath
                        ? "/" + this.plugin.settings.basePath
                        : "");
                stdout.on("data", (chunk) => {
                    body += chunk.toString("utf8");
                });
                stdout.on("end", async () => {
                    const submods = body.split("\n");

                    // Remove words like `Entering` in front of each line and filter empty lines
                    const strippedSubmods: string[] = submods
                        .map((i) => {
                            const submod = i.match(/'([^']*)'/);
                            if (submod != undefined) {
                                return root + "/" + submod[1] + sep;
                            }
                        })
                        .filter((i): i is string => !!i);

                    strippedSubmods.reverse();
                    resolve(strippedSubmods);
                });
            });

            await this.git.subModule(["foreach", "--recursive", ""]);
            this.git.outputHandler(() => {});
        });
    }

    //Remove wrong `"` like "My file.md"
    formatPath(
        path: { from?: string; path: string },
        renamed = false
    ): { path: string; from?: string } {
        function format(path?: string): string | undefined {
            if (path == undefined) return undefined;

            if (path.startsWith('"') && path.endsWith('"')) {
                return path.substring(1, path.length - 1);
            } else {
                return path;
            }
        }
        if (renamed) {
            return {
                from: format(path.from),
                path: format(path.path)!,
            };
        } else {
            return {
                path: format(path.path)!,
            };
        }
    }

    async blame(
        path: string,
        trackMovement: LineAuthorFollowMovement,
        ignoreWhitespace: boolean
    ): Promise<Blame | "untracked"> {
        path = this.getRelativeRepoPath(path);

        if (!(await this.isTracked(path))) return "untracked";

        const inSubmodule = await this.getSubmoduleOfFile(path);
        const args = inSubmodule ? ["-C", inSubmodule.submodule] : [];
        const relativePath = inSubmodule ? inSubmodule.relativeFilepath : path;

        args.push("blame", "--porcelain");

        if (ignoreWhitespace) args.push("-w");

        const trackCArg = `-C${GIT_LINE_AUTHORING_MOVEMENT_DETECTION_MINIMAL_LENGTH}`;
        switch (trackMovement) {
            case "inactive":
                break;
            case "same-commit":
                args.push("-C", trackCArg);
                break;
            case "all-commits":
                args.push("-C", "-C", trackCArg);
                break;
            default:
                impossibleBranch(trackMovement);
        }

        args.push("--", relativePath);

        const rawBlame = await this.git.raw(
            args,
            (err) => err && console.warn("git-blame", err)
        );
        return parseBlame(rawBlame);
    }

    async isTracked(path: string): Promise<boolean> {
        const inSubmodule = await this.getSubmoduleOfFile(path);
        const args = inSubmodule ? ["-C", inSubmodule.submodule] : [];
        const relativePath = inSubmodule ? inSubmodule.relativeFilepath : path;

        args.push("ls-files", "--", relativePath);
        return this.git
            .raw(args, (err) => err && console.warn("ls-files", err))
            .then((x) => x.trim() !== "");
    }

    async commitAll({ message }: { message: string }): Promise<number> {
        if (this.plugin.settings.updateSubmodules) {
            this.plugin.setState(PluginState.commit);
            const submodulePaths = await this.getSubmodulePaths();
            for (const item of submodulePaths) {
                await this.git
                    .cwd({ path: item, root: false })
                    .add("-A", (err) => this.onError(err));
                await this.git
                    .cwd({ path: item, root: false })
                    .commit(await this.formatCommitMessage(message), (err) =>
                        this.onError(err)
                    );
            }
        }
        this.plugin.setState(PluginState.add);

        await this.git.add("-A", (err) => this.onError(err));

        this.plugin.setState(PluginState.commit);

        const res = await this.git.commit(
            await this.formatCommitMessage(message),
            (err) => this.onError(err)
        );
        dispatchEvent(new CustomEvent("git-head-update"));

        return res.summary.changes;
    }

    async commit({
        message,
        amend,
    }: {
        message: string;
        amend?: boolean;
    }): Promise<number> {
        this.plugin.setState(PluginState.commit);

        const res = (
            await this.git.commit(
                await this.formatCommitMessage(message),
                amend ? ["--amend"] : [],
                (err) => this.onError(err)
            )
        ).summary.changes;
        dispatchEvent(new CustomEvent("git-head-update"));

        this.plugin.setState(PluginState.idle);
        return res;
    }

    async stage(path: string, relativeToVault: boolean): Promise<void> {
        this.plugin.setState(PluginState.add);

        path = this.getRelativeRepoPath(path, relativeToVault);
        await this.git.add(["--", path], (err) => this.onError(err));

        this.plugin.setState(PluginState.idle);
    }

    async stageAll({ dir }: { dir?: string }): Promise<void> {
        this.plugin.setState(PluginState.add);
        await this.git.add(dir ?? "-A", (err) => this.onError(err));
        this.plugin.setState(PluginState.idle);
    }

    async unstageAll({ dir }: { dir?: string }): Promise<void> {
        this.plugin.setState(PluginState.add);
        await this.git.reset(dir != undefined ? ["--", dir] : [], (err) =>
            this.onError(err)
        );
        this.plugin.setState(PluginState.idle);
    }

    async unstage(path: string, relativeToVault: boolean): Promise<void> {
        this.plugin.setState(PluginState.add);

        path = this.getRelativeRepoPath(path, relativeToVault);
        await this.git.reset(["--", path], (err) => this.onError(err));

        this.plugin.setState(PluginState.idle);
    }

    async discard(filepath: string): Promise<void> {
        this.plugin.setState(PluginState.add);
        await this.git.checkout(["--", filepath], (err) => this.onError(err));
        this.plugin.setState(PluginState.idle);
    }

    async hashObject(filepath: string): Promise<string> {
        // Need to use raw command here to ensure filenames are literally used.
        // Perhaps we could file a PR? https://github.com/steveukx/git-js/blob/main/simple-git/src/lib/tasks/hash-object.ts
        filepath = this.getRelativeRepoPath(filepath);
        const inSubmodule = await this.getSubmoduleOfFile(filepath);
        const args = inSubmodule ? ["-C", inSubmodule.submodule] : [];
        const relativeFilepath = inSubmodule
            ? inSubmodule.relativeFilepath
            : filepath;

        args.push("hash-object", "--", relativeFilepath);

        const revision = this.git.raw(args);
        revision.catch(
            (err) =>
                err &&
                console.warn("obsidian-git. hash-object failed:", err?.message)
        );
        return revision;
    }

    async discardAll({ dir }: { dir?: string }): Promise<void> {
        return this.discard(dir ?? ".");
    }

    async pull(): Promise<FileStatusResult[] | undefined> {
        this.plugin.setState(PluginState.pull);
        if (this.plugin.settings.updateSubmodules)
            await this.git.subModule(
                ["update", "--remote", "--merge", "--recursive"],
                (err) => this.onError(err)
            );

        const branchInfo = await this.branchInfo();
        const localCommit = await this.git.revparse(
            [branchInfo.current!],
            (err) => this.onError(err)
        );

        if (!branchInfo.tracking && this.plugin.settings.updateSubmodules) {
            this.plugin.log(
                "No tracking branch found. Ignoring pull of main repo and updating submodules only."
            );
            return;
        }

        await this.git.fetch((err) => this.onError(err));
        const upstreamCommit = await this.git.revparse(
            [branchInfo.tracking!],
            (err) => this.onError(err)
        );

        if (localCommit !== upstreamCommit) {
            if (
                this.plugin.settings.syncMethod === "merge" ||
                this.plugin.settings.syncMethod === "rebase"
            ) {
                try {
                    switch (this.plugin.settings.syncMethod) {
                        case "merge":
                            await this.git.merge([branchInfo.tracking!]);
                            break;
                        case "rebase":
                            await this.git.rebase([branchInfo.tracking!]);
                    }
                } catch (err) {
                    this.plugin.displayError(
                        `Pull failed (${this.plugin.settings.syncMethod}): ${err.message}`
                    );
                    return;
                }
            } else if (this.plugin.settings.syncMethod === "reset") {
                try {
                    await this.git.raw(
                        [
                            "update-ref",
                            `refs/heads/${branchInfo.current}`,
                            upstreamCommit,
                        ],
                        (err) => this.onError(err)
                    );
                    await this.unstageAll({});
                } catch (err) {
                    this.plugin.displayError(
                        `Sync failed (${this.plugin.settings.syncMethod}): ${err.message}`
                    );
                }
            }
            dispatchEvent(new CustomEvent("git-head-update"));

            const afterMergeCommit = await this.git.revparse(
                [branchInfo.current!],
                (err) => this.onError(err)
            );

            const filesChanged = await this.git.diff([
                `${localCommit}..${afterMergeCommit}`,
                "--name-only",
            ]);

            return filesChanged
                .split(/\r\n|\r|\n/)
                .filter((value) => value.length > 0)
                .map((e) => {
                    return <FileStatusResult>{
                        path: e,
                        working_dir: "P",
                        vault_path: this.getRelativeVaultPath(e),
                    };
                });
        } else {
            return [];
        }
    }

    async push(): Promise<number | undefined> {
        this.plugin.setState(PluginState.push);
        if (this.plugin.settings.updateSubmodules) {
            const res = await this.git
                .env({ ...process.env, OBSIDIAN_GIT: 1 })
                .subModule(
                    [
                        "foreach",
                        "--recursive",
                        `tracking=$(git for-each-ref --format='%(upstream:short)' "$(git symbolic-ref -q HEAD)"); echo $tracking; if [ ! -z "$(git diff --shortstat $tracking)" ]; then git push; fi`,
                    ],
                    (err) => this.onError(err)
                );
            console.log(res);
        }
        const status = await this.git.status();
        const trackingBranch = status.tracking!;
        const currentBranch = status.current!;

        if (!trackingBranch && this.plugin.settings.updateSubmodules) {
            this.plugin.log(
                "No tracking branch found. Ignoring push of main repo and updating submodules only."
            );
            return undefined;
        }

        const remoteChangedFiles = (
            await this.git.diffSummary(
                [currentBranch, trackingBranch, "--"],
                (err) => this.onError(err)
            )
        ).changed;

        await this.git
            .env({ ...process.env, OBSIDIAN_GIT: 1 })
            .push((err) => this.onError(err));

        return remoteChangedFiles;
    }

    async getUnpushedCommits(): Promise<number> {
        const status = await this.git.status();
        const trackingBranch = status.tracking;
        const currentBranch = status.current;

        if (trackingBranch == null || currentBranch == null) {
            return 0;
        }

        const remoteChangedFiles = (
            await this.git.diffSummary(
                [currentBranch, trackingBranch, "--"],
                (err) => this.onError(err)
            )
        ).changed;

        return remoteChangedFiles;
    }

    async canPush(): Promise<boolean> {
        // allow pushing in submodules even if the root has no changes.
        if (this.plugin.settings.updateSubmodules === true) {
            return true;
        }
        const status = await this.git.status((err) => this.onError(err));
        const trackingBranch = status.tracking;
        const currentBranch = status.current!;
        if (!trackingBranch) {
            return false;
        }
        const remoteChangedFiles = (
            await this.git.diffSummary([currentBranch, trackingBranch, "--"])
        ).changed;

        return remoteChangedFiles !== 0;
    }

    async checkRequirements(): Promise<
        "valid" | "missing-repo" | "missing-git"
    > {
        if (!this.isGitInstalled()) {
            return "missing-git";
        }
        if (!(await this.git.checkIsRepo())) {
            return "missing-repo";
        }
        return "valid";
    }

    async branchInfo(): Promise<BranchInfo> {
        const status = await this.git.status((err) => this.onError(err));
        const branches = await this.git.branch(["--no-color"], (err) =>
            this.onError(err)
        );

        return {
            current: status.current || undefined,
            tracking: status.tracking || undefined,
            branches: branches.all,
        };
    }

    async getRemoteUrl(remote: string): Promise<string | undefined> {
        try {
            return (await this.git.remote(["get-url", remote])) || undefined;
        } catch (error) {
            // Verify the error is at least not about git is not found or similar. Checks if the remote exists or not
            if (error.toString().contains(remote)) {
                return undefined;
            } else {
                this.onError(error);
            }
        }
    }

    // https://github.com/kometenstaub/obsidian-version-history-diff/issues/3
    async log(
        file: string | undefined,
        relativeToVault = true,
        limit?: number
    ): Promise<(LogEntry & { fileName?: string })[]> {
        let path: string | undefined;
        if (file) {
            path = this.getRelativeRepoPath(file, relativeToVault);
        }
        const res = await this.git.log(
            {
                file: path,
                maxCount: limit,
                "-m": null,
                "--name-status": null,
            },
            (err) => this.onError(err)
        );

        return res.all.map<LogEntry>((e) => ({
            ...e,
            author: {
                name: e.author_name,
                email: e.author_email,
            },
            refs: e.refs.split(", ").filter((e) => e.length > 0),
            diff: {
                ...e.diff!,
                files:
                    e.diff?.files.map((f) => ({
                        ...f,
                        status: f.status!,
                        path: f.file,
                        hash: e.hash,
                        vault_path: this.getRelativeVaultPath(f.file),
                    })) ?? [],
            },
            fileName: e.diff?.files.first()?.file,
        }));
    }

    async show(
        commitHash: string,
        file: string,
        relativeToVault = true
    ): Promise<string> {
        const path = this.getRelativeRepoPath(file, relativeToVault);

        return this.git.show([commitHash + ":" + path], (err) =>
            this.onError(err)
        );
    }

    async checkout(branch: string, remote?: string): Promise<void> {
        if (remote) {
            branch = `${remote}/${branch}`;
        }
        await this.git.checkout(branch, (err) => this.onError(err));
        if (this.plugin.settings.submoduleRecurseCheckout) {
            const submodulePaths = await this.getSubmodulePaths();
            for (const submodulePath of submodulePaths) {
                const branchSummary = await this.git
                    .cwd({ path: submodulePath, root: false })
                    .branch();
                if (Object.keys(branchSummary.branches).includes(branch)) {
                    await this.git
                        .cwd({ path: submodulePath, root: false })
                        .checkout(branch, (err) => this.onError(err));
                }
            }
        }
    }

    async createBranch(branch: string): Promise<void> {
        await this.git.checkout(["-b", branch], (err) => this.onError(err));
    }

    async deleteBranch(branch: string, force: boolean): Promise<void> {
        await this.git.branch([force ? "-D" : "-d", branch], (err) =>
            this.onError(err)
        );
    }

    async branchIsMerged(branch: string): Promise<boolean> {
        const notMergedBranches = await this.git.branch(
            ["--no-merged"],
            (err) => this.onError(err)
        );
        return !notMergedBranches.all.contains(branch);
    }

    async init(): Promise<void> {
        await this.git.init(false, (err) => this.onError(err));
    }

    async clone(url: string, dir: string, depth?: number): Promise<void> {
        await this.git.clone(
            url,
            path.join(
                (this.app.vault.adapter as FileSystemAdapter).getBasePath(),
                dir
            ),
            depth ? ["--depth", `${depth}`] : [],
            (err) => this.onError(err)
        );
    }

    async setConfig(path: string, value: any): Promise<void> {
        if (value == undefined) {
            await this.git.raw(["config", "--local", "--unset", path]);
        } else {
            await this.git.addConfig(path, value, (err) => this.onError(err));
        }
    }

    async getConfig(path: string): Promise<any> {
        const config = await this.git.listConfig("local", (err) =>
            this.onError(err)
        );
        return config.all[path];
    }

    async fetch(remote?: string): Promise<void> {
        await this.git.fetch(remote != undefined ? [remote] : [], (err) =>
            this.onError(err)
        );
    }

    async setRemote(name: string, url: string): Promise<void> {
        if ((await this.getRemotes()).includes(name))
            await this.git.remote(["set-url", name, url], (err) =>
                this.onError(err)
            );
        else {
            await this.git.remote(["add", name, url], (err) =>
                this.onError(err)
            );
        }
    }

    async getRemoteBranches(remote: string): Promise<string[]> {
        const res = await this.git.branch(
            ["-r", "--list", `${remote}*`],
            (err) => this.onError(err)
        );

        const list = [];
        for (const item in res.branches) {
            list.push(res.branches[item].name);
        }
        return list;
    }

    async getRemotes() {
        const res = await this.git.remote([], (err) => this.onError(err));
        if (res) {
            return res.trim().split("\n");
        } else {
            return [];
        }
    }

    async removeRemote(remoteName: string) {
        await this.git.removeRemote(remoteName);
    }

    async updateUpstreamBranch(remoteBranch: string) {
        try {
            // git 1.8+
            await this.git.branch(["--set-upstream-to", remoteBranch]);
        } catch (e) {
            console.error(e);
            try {
                // git 1.7 - 1.8
                await this.git.branch(["--set-upstream", remoteBranch]);
            } catch (e) {
                console.error(e);
                // fallback
                await this.git.push(
                    // A type error occurs here because the third element could be undefined.
                    // However, it is unlikely to be undefined due to the `remoteBranch`'s format, and error handling is in place.
                    // Therefore, we temporarily ignore the error.
                    // @ts-ignore
                    ["--set-upstream", ...splitRemoteBranch(remoteBranch)],
                    (err) => this.onError(err)
                );
            }
        }
    }

    updateGitPath(gitPath: string) {
        this.setGitInstance();
    }

    updateBasePath(basePath: string) {
        this.setGitInstance(true);
    }

    async getDiffString(
        filePath: string,
        stagedChanges = false,
        hash?: string
    ): Promise<string> {
        if (stagedChanges)
            return await this.git.diff(["--cached", "--", filePath]);
        if (hash) return await this.git.show([`${hash}`, "--", filePath]);
        else return await this.git.diff(["--", filePath]);
    }

    async diff(
        file: string,
        commit1: string,
        commit2: string
    ): Promise<string> {
        return await this.git.diff([`${commit1}..${commit2}`, "--", file]);
    }

    private async getSubmoduleOfFile(
        repositoryRelativeFile: string
    ): Promise<{ submodule: string; relativeFilepath: string } | undefined> {
        // Documentation: https://git-scm.com/docs/git-rev-parse

        // git -C <dir-of-file> rev-parse --show-toplevel
        // returns the submodules repository root as an absolute path
        let submoduleRoot = await this.git.raw(
            [
                "-C",
                path.dirname(repositoryRelativeFile),
                "rev-parse",
                "--show-toplevel",
            ],
            (err) => err && console.warn("get-submodule-of-file", err?.message)
        );
        submoduleRoot = submoduleRoot.trim();

        // git -C <dir-of-file> rev-parse --show-superproject-working-tree
        // returns the parent git repository, if the file is in a submodule - otherwise empty.
        const superProject = await this.git.raw(
            [
                "-C",
                path.dirname(repositoryRelativeFile),
                "rev-parse",
                "--show-superproject-working-tree",
            ],
            (err) => err && console.warn("get-submodule-of-file", err?.message)
        );

        if (superProject.trim() === "") {
            return undefined; // not in submodule
        }

        const fsAdapter = this.app.vault.adapter as FileSystemAdapter;
        const absolutePath = fsAdapter.getFullPath(
            path.normalize(repositoryRelativeFile)
        );
        const newRelativePath = path.relative(submoduleRoot, absolutePath);

        return { submodule: submoduleRoot, relativeFilepath: newRelativePath };
    }

    async getLastCommitTime(): Promise<Date | undefined> {
        const res = await this.git.log({ n: 1 }, (err) => this.onError(err));
        if (res != null && res.latest != null) {
            return new Date(res.latest.date);
        }
    }

    private isGitInstalled(): boolean {
        // https://github.com/steveukx/git-js/issues/402
        const command = spawnSync(
            this.plugin.localStorage.getGitPath() || "git",
            ["--version"],
            {
                stdio: "ignore",
            }
        );

        if (command.error) {
            console.error(command.error);
            return false;
        }
        return true;
    }

    private onError(error: Error | null) {
        if (error) {
            const networkFailure =
                error.message.contains("Could not resolve host") ||
                error.message.match(
                    /ssh: connect to host .*? port .*?: Operation timed out/
                ) ||
                error.message.match(
                    /ssh: connect to host .*? port .*?: Network is unreachable/
                );
            if (!networkFailure) {
                this.plugin.displayError(error.message);
                this.plugin.setState(PluginState.idle);
            } else if (!this.plugin.offlineMode) {
                this.plugin.displayError(
                    "Git: Going into offline mode. Future network errors will no longer be displayed.",
                    2000
                );
            }

            if (networkFailure) {
                this.plugin.offlineMode = true;
                this.plugin.setState(PluginState.idle);
            }
        }
    }
}

export const zeroCommit: BlameCommit = {
    hash: "000000",
    isZeroCommit: true,
    summary: "",
};

// Parse git blame porcelain format: https://git-scm.com/docs/git-blame#_the_porcelain_format
function parseBlame(blameOutputUnnormalized: string): Blame {
    const blameOutput = blameOutputUnnormalized.replace("\r\n", "\n");

    const blameLines = blameOutput.split("\n");

    const result: Blame = {
        commits: new Map(),
        hashPerLine: [undefined!], // one-based indices
        originalFileLineNrPerLine: [undefined!],
        finalFileLineNrPerLine: [undefined!],
        groupSizePerStartingLine: new Map(),
    };

    let line = 1;
    for (let bi = 0; bi < blameLines.length; ) {
        if (startsWithNonWhitespace(blameLines[bi])) {
            const lineInfo = blameLines[bi].split(" ");

            const commitHash = parseLineInfoInto(lineInfo, line, result);
            bi++;

            // parse header values until a tab is encountered
            for (; startsWithNonWhitespace(blameLines[bi]); bi++) {
                const spaceSeparatedHeaderValues = blameLines[bi].split(" ");
                parseHeaderInto(spaceSeparatedHeaderValues, result, line);
            }
            finalizeBlameCommitInfo(result.commits.get(commitHash)!);

            // skip tab prefixed line
            line += 1;
        } else if (blameLines[bi] === "" && bi === blameLines.length - 1) {
            // EOF
        } else {
            throw Error(
                `Expected non-whitespace line or EOF, but found: ${blameLines[bi]}`
            );
        }
        bi++;
    }
    return result;
}

function parseLineInfoInto(lineInfo: string[], line: number, result: Blame) {
    const hash = lineInfo[0];
    result.hashPerLine.push(hash);
    result.originalFileLineNrPerLine.push(parseInt(lineInfo[1]));
    result.finalFileLineNrPerLine.push(parseInt(lineInfo[2]));
    lineInfo.length >= 4 &&
        result.groupSizePerStartingLine.set(line, parseInt(lineInfo[3]));

    if (parseInt(lineInfo[2]) !== line) {
        throw Error(
            `git-blame output is out of order: ${line} vs ${lineInfo[2]}`
        );
    }

    return hash;
}

function parseHeaderInto(header: string[], out: Blame, line: number) {
    const key = header[0];
    const value = header.slice(1).join(" ");
    const commitHash = out.hashPerLine[line];
    const commit =
        out.commits.get(commitHash) ||
        <BlameCommit>{
            hash: commitHash,
            author: {},
            committer: {},
            previous: {},
        };

    switch (key) {
        case "summary":
            commit.summary = value;
            break;

        case "author":
            commit.author!.name = value;
            break;
        case "author-mail":
            commit.author!.email = removeEmailBrackets(value);
            break;
        case "author-time":
            commit.author!.epochSeconds = parseInt(value);
            break;
        case "author-tz":
            commit.author!.tz = value;
            break;

        case "committer":
            commit.committer!.name = value;
            break;
        case "committer-mail":
            commit.committer!.email = removeEmailBrackets(value);
            break;
        case "committer-time":
            commit.committer!.epochSeconds = parseInt(value);
            break;
        case "committer-tz":
            commit.committer!.tz = value;
            break;

        case "previous":
            commit.previous!.commitHash = value;
            break;
        case "filename":
            commit.previous!.filename = value;
            break;
    }
    out.commits.set(commitHash, commit);
}

function finalizeBlameCommitInfo(commit: BlameCommit) {
    if (commit.summary === undefined) {
        throw Error(`Summary not provided for commit: ${commit.hash}`);
    }

    if (isUndefinedOrEmptyObject(commit.author)) {
        commit.author = undefined;
    }
    if (isUndefinedOrEmptyObject(commit.committer)) {
        commit.committer = undefined;
    }
    if (isUndefinedOrEmptyObject(commit.previous)) {
        commit.previous = undefined;
    }

    commit.isZeroCommit = Boolean(commit.hash.match(/^0*$/));
}

function isUndefinedOrEmptyObject(obj: object | undefined | null): boolean {
    return !obj || Object.keys(obj).length === 0;
}

function startsWithNonWhitespace(str: string): boolean {
    return str.length > 0 && str[0].trim() === str[0];
}

function removeEmailBrackets(gitEmail: string) {
    const prefixCleaned = gitEmail.startsWith("<")
        ? gitEmail.substring(1)
        : gitEmail;
    return prefixCleaned.endsWith(">")
        ? prefixCleaned.substring(0, prefixCleaned.length - 1)
        : prefixCleaned;
}
