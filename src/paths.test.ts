import { describe, expect, it } from "vitest";
import { expandHomePath, tildifyPath, tildifyPathText } from "../shared/paths";

describe("home-relative path display", () => {
  it("shortens the exact home and descendants, including spaces and file references", () => {
    expect(tildifyPath("/Users/alice", "/Users/alice/")).toBe("~");
    expect(tildifyPath("/Users/alice/Library/Application Support/Forge/file.ts:12", "/Users/alice"))
      .toBe("~/Library/Application Support/Forge/file.ts:12");
    expect(tildifyPath("/home/alice/project", "/home/alice")).toBe("~/project");
  });
  it("keeps unrelated homes, prefix collisions, relative paths and URLs unchanged", () => {
    for (const value of ["/Users/alice-other/file", "/Users/alice.backup/file", "/Users/bob/file", "src/file", "~/file", "https://example.com/Users/alice/file", "file:///Users/alice/file"])
      expect(tildifyPath(value, "/Users/alice")).toBe(value);
    expect(tildifyPath("/Users/alice/file", "")).toBe("/Users/alice/file");
  });
  it("shortens paths in human messages without rewriting URL targets or sibling paths", () => {
    const text = 'Could not open "/Users/alice/Library/Application Support/a.pdf" or /Users/alice-other/b.pdf. https://host/Users/alice/a';
    expect(tildifyPathText(text, "/Users/alice"))
      .toBe('Could not open "~/Library/Application Support/a.pdf" or /Users/alice-other/b.pdf. https://host/Users/alice/a');
    expect(tildifyPathText("Open `/home/a.b[1]/file`", "/home/a.b[1]" )).toBe("Open `~/file`");
    expect(tildifyPathText("Keep /home/axb1/file", "/home/a.b[1]")).toBe("Keep /home/axb1/file");
    expect(tildifyPathText("https://host/?path=/Users/alice/file and /Users/alice/file", "/Users/alice"))
      .toBe("https://host/?path=/Users/alice/file and ~/file");
  });
  it("expands local settings back to operational paths and leaves Windows unchanged", () => {
    expect(expandHomePath("~/tools/codex", "/Users/alice")).toBe("/Users/alice/tools/codex");
    expect(expandHomePath("~", "/Users/alice")).toBe("/Users/alice");
    expect(expandHomePath("~someone/tools", "/Users/alice")).toBe("~someone/tools");
    for (const home of ["C:\\Users\\alice", "C:/Users/alice"]) {
      expect(tildifyPath(`${home}/file`, home)).toBe(`${home}/file`);
      expect(tildifyPathText(`Open ${home}/file`, home)).toBe(`Open ${home}/file`);
      expect(expandHomePath("~/file", home)).toBe("~/file");
    }
  });
});
