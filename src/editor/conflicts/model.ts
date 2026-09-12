export type ConflictChoice = "ours" | "theirs" | "both";

export interface ConflictBlock {
    from: number;
    to: number;
    ours: string;
    theirs: string;
    base?: string;
    startMarker: { from: number; to: number };
    separatorMarker: { from: number; to: number };
    endMarker: { from: number; to: number };
}

interface Line {
    from: number;
    to: number;
    text: string;
}

const START_MARKER = /^<{7}(?:[ \t].*)?$/;
const BASE_MARKER = /^\|{7}(?:[ \t].*)?$/;
const SEPARATOR = /^={7}(?:[ \t].*)?$/;
const END_MARKER = /^>{7}(?:[ \t].*)?$/;

function getLines(text: string): Line[] {
    const lines: Line[] = [];
    let from = 0;
    while (from <= text.length) {
        const newline = text.indexOf("\n", from);
        const to = newline === -1 ? text.length : newline;
        lines.push({ from, to, text: text.slice(from, to) });
        if (newline === -1) {
            break;
        }
        from = newline + 1;
    }
    return lines;
}

export function parseConflictBlocks(text: string): ConflictBlock[] {
    const lines = getLines(text);
    const blocks: ConflictBlock[] = [];

    for (let i = 0; i < lines.length; i++) {
        const start = lines[i]!;
        if (!START_MARKER.test(start.text)) {
            continue;
        }

        let baseIndex = -1;
        let separatorIndex = -1;
        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j]!;
            if (SEPARATOR.test(line.text)) {
                separatorIndex = j;
                break;
            }
            if (baseIndex === -1 && BASE_MARKER.test(line.text)) {
                baseIndex = j;
            }
        }
        if (separatorIndex === -1) {
            continue;
        }

        let endIndex = -1;
        for (let k = separatorIndex + 1; k < lines.length; k++) {
            const line = lines[k]!;
            if (END_MARKER.test(line.text)) {
                endIndex = k;
                break;
            }
            if (START_MARKER.test(line.text)) {
                break;
            }
        }
        if (endIndex === -1) {
            continue;
        }

        const separator = lines[separatorIndex]!;
        const end = lines[endIndex]!;
        blocks.push({
            from: start.from,
            to: end.to < text.length ? end.to + 1 : end.to,
            ours: text.slice(
                start.to + 1,
                baseIndex !== -1 ? lines[baseIndex]!.from : separator.from
            ),
            theirs: text.slice(separator.to + 1, end.from),
            base:
                baseIndex !== -1
                    ? text.slice(lines[baseIndex]!.to + 1, separator.from)
                    : undefined,
            startMarker: { from: start.from, to: start.to },
            separatorMarker: { from: separator.from, to: separator.to },
            endMarker: { from: end.from, to: end.to },
        });

        i = endIndex;
    }

    return blocks;
}

export function resolveBlockText(
    block: Pick<ConflictBlock, "ours" | "theirs">,
    choice: ConflictChoice
): string {
    switch (choice) {
        case "ours":
            return block.ours;
        case "theirs":
            return block.theirs;
        case "both":
            return block.ours + block.theirs;
    }
}
