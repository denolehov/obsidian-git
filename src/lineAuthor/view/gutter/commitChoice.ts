import { moment } from "obsidian";
import { LineAuthoring } from "src/lineAuthor/model";
import { BlameCommit } from "src/types";

/**
 * Chooses the newest commit from the {@link LineAuthoring} for the
 * lines {@link startLine} to {@link endLine} (inclusive).
 */
export function chooseNewestCommit(
    lineAuthoring: Exclude<LineAuthoring, "untracked">,
    startLine: number,
    endLine: number
): BlameCommit {
    let newest: BlameCommit = undefined!;

    for (let line = startLine; line <= endLine; line++) {
        const currentHash = lineAuthoring.hashPerLine[line];
        const currentCommit = lineAuthoring.commits.get(currentHash)!;

        if (
            !newest ||
            currentCommit.isZeroCommit ||
            isNewerThan(currentCommit, newest)
        ) {
            newest = currentCommit;
        }
    }

    return newest;
}

function isNewerThan(left: BlameCommit, right: BlameCommit): boolean {
    const l = getAbsoluteAuthoringMoment(left);
    const r = getAbsoluteAuthoringMoment(right);
    const diff = l.diff(r, "minutes"); // l - r > 0  <=>  l > r  <=>  l is newer
    return diff > 0;
}

function getAbsoluteAuthoringMoment(commit: BlameCommit): moment.Moment {
    return moment
        .unix(commit.author!.epochSeconds)
        .utcOffset(commit.author!.tz);
}
