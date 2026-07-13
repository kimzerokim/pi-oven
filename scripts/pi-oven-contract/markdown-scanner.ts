export const TASK_EXAMPLE_MARKER = "<!-- pi-oven-contract:task-example -->";

export interface SourceLocation {
  line: number;
  column: number;
}

export interface MarkdownFence {
  info: string;
  content: string;
  openingLine: number;
  contentLine: number;
  markerLine?: number;
}

export interface MarkdownScan {
  fences: MarkdownFence[];
}

export function locationAt(source: string, offset: number): SourceLocation {
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

/**
 * Scan CommonMark-style backtick and tilde fences without interpreting prose.
 * The contract marker must be the closest non-empty line before a fence.
 */
export function scanMarkdown(source: string): MarkdownScan {
  const lines = source.split(/\r?\n/);
  const fences: MarkdownFence[] = [];

  for (let index = 0; index < lines.length; index++) {
    const opening = lines[index].match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)?.*$/);
    if (!opening) continue;

    const delimiter = opening[1][0].repeat(opening[1].length);
    const content: string[] = [];
    let closing = index + 1;
    while (closing < lines.length && !new RegExp(`^\\s*${delimiter[0]}{${delimiter.length},}\\s*$`).test(lines[closing])) {
      content.push(lines[closing]);
      closing++;
    }

    let previous = index - 1;
    while (previous >= 0 && lines[previous].trim() === "") previous--;
    const markerLine = lines[previous]?.trim() === TASK_EXAMPLE_MARKER ? previous + 1 : undefined;

    fences.push({
      info: opening[2] ?? "",
      content: content.join("\n"),
      openingLine: index + 1,
      contentLine: index + 2,
      markerLine,
    });
    index = closing;
  }

  return { fences };
}
