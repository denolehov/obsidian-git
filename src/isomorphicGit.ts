import http from "isomorphic-git/http/web";
import git, { ReadCommitResult } from "isomorphic-git/index.umd.min";
import { Notice } from 'obsidian';
import { GitManager } from "./gitManager";
import ObsidianGit from './main';
import { MyAdapter } from './myAdapter';
import { BranchInfo, DiffResult, FileStatusResult, PluginState, Status } from './types';
export class IsomorphicGit extends GitManager {
    private repo: {
        fs: MyAdapter,
        dir: string,
    };
    private readonly FILE = 0;
    private readonly HEAD = 1;
    private readonly WORKDIR = 2;
    private readonly STAGE = 3;
    private readonly indexes = {
        "000": "",
        "003": "AD",
        "020": "??",
        "022": "A",
        "023": "AM",
        "100": "D ",
        "101": " D",
        "103": "MD",
        "110": "D ??",
        "111": "",
        "120": "D ??",
        "121": " M",
        "122": "M ",
        "123": "MM"
    };
    private readonly noticeLength = 999999;

    constructor(plugin: ObsidianGit) {
        super(plugin);

        this.repo = {
            fs: new MyAdapter(this.app.vault),
            dir: "",
        };
    }

    async status(): Promise<Status> {
        this.plugin.setState(PluginState.status);
        try {
            const status = await git.statusMatrix(this.repo);

            const changed: FileStatusResult[] = status.filter(row => row[this.HEAD] !== row[this.WORKDIR]).map(row => this.getFileStatusResult(row));
            const staged = status.filter(row => row[this.STAGE] === 3 || row[this.STAGE] === 2).map(row => row[this.FILE]);

            return {
                changed: changed,
                staged: staged,
            };
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    }

    async commitAll(message?: string): Promise<number | undefined> {
        this.plugin.setState(PluginState.commit);
        try {
            const commitBefore = await this.getCurrentCommit();
            const status = await git.statusMatrix(this.repo);
            await Promise.all(
                status.map(([filepath, , worktreeStatus]) =>
                    worktreeStatus ? git.add({ ...this.repo, filepath }) : git.remove({ ...this.repo, filepath })
                )
            );
            const formatMessage = message ?? await this.formatCommitMessage();

            await git.commit({
                ...this.repo,
                message: formatMessage,
            });
            const commitAfter = await this.getCurrentCommit();
            this.plugin.lastUpdate = Date.now();

            //If the repo has no commits yet, `commitBefore` is undefined
            if (commitBefore) {
                return await this.getChangedFiles(commitBefore.oid, commitAfter.oid);
            } else {
                return undefined;
            }
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    }

    async pull(): Promise<number> {
        this.plugin.setState(PluginState.pull);
        const progressNotice = new Notice("Initializing clone", this.noticeLength);
        try {
            const commitBefore = await this.getCurrentCommit();

            await git.pull({
                ...this.repo,
                http: http,
                corsProxy: this.plugin.settings.proxyURL,
                headers: { "Authorization": this.getAuth() },
                onProgress: (progress) => {
                    (progressNotice as any).noticeEl.innerText = `Cloning progress: ${progress.phase}: ${progress.loaded} of ${progress.total}`;
                }
            });
            this.plugin.lastUpdate = Date.now();

            const commitAfter = await this.getCurrentCommit();
            progressNotice.hide();
            return await this.getChangedFiles(commitBefore.oid, commitAfter.oid);
        } catch (error) {
            progressNotice.hide();
            this.plugin.displayError(error);
            throw error;
        }

    };

    async push(): Promise<number> {
        this.plugin.setState(PluginState.push);
        const progressNotice = new Notice("Initializing clone", this.noticeLength);
        try {
            const branchInfo = await this.branchInfo();
            const changedFiles = await this.getChangedFiles(branchInfo.current, branchInfo.tracking);


            await git.push({
                ...this.repo,
                http: http,
                corsProxy: this.plugin.settings.proxyURL,
                headers: { "Authorization": this.getAuth() },
                onProgress: (progress) => {
                    (progressNotice as any).noticeEl.innerText = `Cloning progress: ${progress.phase}: ${progress.loaded} of ${progress.total}`;
                }
            });
            this.plugin.lastUpdate = Date.now();
            progressNotice.hide();
            return changedFiles;
        } catch (error) {
            progressNotice.hide();
            this.plugin.displayError(error);
            throw error;
        }

    };

    async canPush(): Promise<boolean> {
        const branchInfo = await this.branchInfo();
        return await this.getChangedFiles(branchInfo.current, branchInfo.tracking) !== 0;
    };

    async checkRequirements(): Promise<"valid" | "missing-repo" | "wrong-settings"> {
        try {
            await git.log({
                ...this.repo,
                depth: 1
            });
        } catch (error) {
            console.log(error);

            if ((error.code === "NotFoundError" && error.data.what === "HEAD")) {
                return "missing-repo";
            }
        }
        const user = await git.getConfig({ ...this.repo, path: "user.name" });
        const email = await git.getConfig({ ...this.repo, path: "user.email" });
        const remoteURL = await git.getConfig({ ...this.repo, path: "remote.origin.url" });

        if (!user || !email || !remoteURL) {
            return "wrong-settings";
        }

        return "valid";
    };

    async branchInfo(): Promise<BranchInfo> {
        try {
            const current = await git.currentBranch(this.repo) || "";

            const branches = await git.listBranches(this.repo);

            const remote = await git.getConfig({
                ...this.repo,
                path: `branch.${current}.remote`
            }) ?? "origin";

            const trackingBranch = (await git.getConfig({
                ...this.repo,
                path: `branch.${current}.merge`
            }))?.split("refs/heads")[1];


            let tracking = trackingBranch ? remote + trackingBranch : undefined;
            return {
                current: current,
                tracking: tracking,
                branches: branches,
            };
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    };

    async checkout(branch: string): Promise<void> {
        try {
            return git.checkout({
                ...this.repo,
                ref: branch,
            });
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    };

    async init(): Promise<void> {
        try {
            await git.init(this.repo);
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    };

    setConfig(path: string, value: any): Promise<void> {
        try {
            return git.setConfig({
                ...this.repo,
                path: path,
                value: value
            });
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    };

    getConfig(path: string): Promise<any> {
        try {
            return git.getConfig({
                ...this.repo,
                path: path
            });
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    };

    async fetch(): Promise<void> {
        if (!this.plugin.settings.proxyURL) {
            new Notice("Please specify a proxy URL");
            return;
        };
        const progressNotice = new Notice("Initializing clone", this.noticeLength);

        try {
            await git.fetch({
                ...this.repo,
                http: http,
                corsProxy: this.plugin.settings.proxyURL,
                headers: { "Authorization": this.getAuth() },
                onProgress: (progress) => {
                    (progressNotice as any).noticeEl.innerText = `Cloning progress: ${progress.phase}: ${progress.loaded} of ${progress.total}`;
                }
            });

        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
        progressNotice.hide();
    }

    async clone(url: string): Promise<void> {
        if (!this.plugin.settings.proxyURL) {
            new Notice("Please specify a proxy URL");
            return;
        };
        const progressNotice = new Notice("Initializing clone", this.noticeLength);
        try {
            await git.clone({
                ...this.repo,
                http: http,
                url: url,
                corsProxy: this.plugin.settings.proxyURL,
                headers: { "Authorization": this.getAuth() },
                onProgress: (progress) => {
                    (progressNotice as any).noticeEl.innerText = `Cloning progress: ${progress.phase}: ${progress.loaded} of ${progress.total}`;
                }
            });
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
        progressNotice.hide();
    }

    private getFileStatusResult(row: [string, 0 | 1, 0 | 1 | 2, 0 | 1 | 2 | 3]): FileStatusResult {
        const index = (this.indexes as any)[`${row[this.HEAD]}${row[this.WORKDIR]}${row[this.STAGE]}`];

        return { index: index, path: row[this.FILE] };
    }

    private async getCurrentCommit(): Promise<ReadCommitResult | undefined> {
        try {
            return (await git.log({
                ...this.repo,
                depth: 1
            }))[0];
        } catch (error) {
            const branch = await this.branchInfo();
            if (error.code === "NotFoundError" && error.data.what === `refs/heads/${branch.current}`) {
                return undefined;
            } else {
                throw error;
            }
        }
    };

    private async getChangedFiles(commitHash1: string, commitHash2: string): Promise<number> {
        return (await this.diff(commitHash1, commitHash2)).filter(file => file.type !== "equal").length;
    };

    // fixed from https://isomorphic-git.org/docs/en/snippets#git-diff-name-status-commithash1-commithash2
    private async diff(commitHash1: string, commitHash2: string): Promise<DiffResult[]> {
        return git.walk({
            ...this.repo,
            trees: [git.TREE({ ref: commitHash1 }), git.TREE({ ref: commitHash2 })],
            map: async (filepath, [A, B]) => {

                // ignore directories
                if (filepath === '.') {
                    return;
                }
                if ((await A?.type()) === 'tree' || (await B?.type()) === 'tree') {
                    return;
                }

                // generate ids
                const Aoid = await A?.oid();
                const Boid = await B?.oid();

                // determine modification type
                let type = 'equal';
                if (Aoid !== Boid) {
                    type = 'modify';
                }
                if (Aoid === undefined) {
                    type = 'remove';
                }
                if (Boid === undefined) {
                    type = 'add';
                }
                if (Aoid === undefined && Boid === undefined) {
                    console.log('Something weird happened:');
                    console.log(A);
                    console.log(B);
                }

                return {
                    path: `/${filepath}`,
                    type: type,
                };
            },
        });
    }

    private getAuth() {
        const username = window.localStorage.getItem(this.plugin.manifest.id + ":username");
        const password = window.localStorage.getItem(this.plugin.manifest.id + ":password");
        return "Basic " + btoa(username + ":" + password);
    }
}