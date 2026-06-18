import { describe, expect, it } from "vitest";
import { parseJavaScriptSpec } from "../src/version/javascript.js";
import { parseRubyRequirement } from "../src/version/ruby.js";
import {
  parsePythonRequirement,
  parsePythonSpecifier,
} from "../src/version/python.js";

describe("parseJavaScriptSpec", () => {
  it("classifies exact versions", () => {
    expect(parseJavaScriptSpec("1.2.3").kind).toBe("exact");
  });

  it("classifies caret/tilde as bounded ranges", () => {
    expect(parseJavaScriptSpec("^1.2.3")).toMatchObject({ kind: "range", isUnbounded: false });
    expect(parseJavaScriptSpec("~1.2.3")).toMatchObject({ kind: "range", isUnbounded: false });
  });

  it("flags wildcard and empty as floating", () => {
    expect(parseJavaScriptSpec("*")).toMatchObject({ kind: "wildcard", isFloating: true });
    expect(parseJavaScriptSpec("")).toMatchObject({ kind: "empty", isFloating: true });
  });

  it("flags dist tags", () => {
    expect(parseJavaScriptSpec("latest")).toMatchObject({ kind: "dist-tag", distTag: "latest" });
    expect(parseJavaScriptSpec("next").kind).toBe("dist-tag");
  });

  it("detects unbounded ranges with no upper bound", () => {
    expect(parseJavaScriptSpec(">=1.0.0")).toMatchObject({ kind: "unbounded-range", isUnbounded: true });
    expect(parseJavaScriptSpec(">2.0.0").isUnbounded).toBe(true);
  });

  it("treats a bounded comparator pair as a range", () => {
    expect(parseJavaScriptSpec(">=1.0.0 <2.0.0")).toMatchObject({ kind: "range", isUnbounded: false });
  });

  it("detects vcs sources and pinning", () => {
    expect(parseJavaScriptSpec("github:user/repo")).toMatchObject({ kind: "vcs", isPinnedVcs: false });
    expect(parseJavaScriptSpec("user/repo#main")).toMatchObject({ kind: "vcs", isPinnedVcs: false });
    expect(
      parseJavaScriptSpec("git+https://example.com/r.git#a1b2c3d4e5f6a7b8c9d0e1f2"),
    ).toMatchObject({ kind: "vcs", isPinnedVcs: true });
    expect(parseJavaScriptSpec("github:user/repo#semver:1.2.3").isPinnedVcs).toBe(true);
  });

  it("handles workspace and npm aliases", () => {
    expect(parseJavaScriptSpec("workspace:*").kind).toBe("workspace");
    expect(parseJavaScriptSpec("npm:left-pad@1.3.0").kind).toBe("exact");
  });
});

describe("parseRubyRequirement", () => {
  it("treats pessimistic constraints as bounded ranges", () => {
    expect(parseRubyRequirement("~> 7.1.0")).toMatchObject({ kind: "range", isUnbounded: false });
  });

  it("flags lower-bound-only as unbounded", () => {
    expect(parseRubyRequirement(">= 7.0")).toMatchObject({ kind: "unbounded-range", isUnbounded: true });
  });

  it("treats a bounded pair as a range", () => {
    expect(parseRubyRequirement(">= 6.0, < 7.0").kind).toBe("range");
  });

  it("treats no constraint as floating", () => {
    expect(parseRubyRequirement("")).toMatchObject({ kind: "empty", isFloating: true });
  });

  it("treats = as exact", () => {
    expect(parseRubyRequirement("= 1.2.3").kind).toBe("exact");
  });
});

describe("parsePythonSpecifier / parsePythonRequirement", () => {
  it("classifies == as exact", () => {
    expect(parsePythonSpecifier("==2.32.3").kind).toBe("exact");
  });

  it("classifies >= as unbounded", () => {
    expect(parsePythonSpecifier(">=2")).toMatchObject({ kind: "unbounded-range", isUnbounded: true });
  });

  it("classifies ~= as a bounded range", () => {
    expect(parsePythonSpecifier("~=2.32").kind).toBe("range");
  });

  it("classifies a bare requirement as floating", () => {
    const req = parsePythonRequirement("requests");
    expect(req?.name).toBe("requests");
    expect(req?.spec.kind).toBe("empty");
  });

  it("parses extras and environment markers", () => {
    const req = parsePythonRequirement('uvicorn[standard]>=0.20 ; python_version >= "3.10"');
    expect(req?.name).toBe("uvicorn");
    expect(req?.spec.isUnbounded).toBe(true);
  });

  it("detects unpinned vs pinned VCS requirements", () => {
    const moving = parsePythonRequirement("pkg @ git+https://example.com/p.git");
    expect(moving?.spec).toMatchObject({ kind: "vcs", isPinnedVcs: false });
    const pinned = parsePythonRequirement("pkg @ git+https://example.com/p.git@v1.2.3");
    expect(pinned?.spec).toMatchObject({ kind: "vcs", isPinnedVcs: true });
  });

  it("ignores option lines", () => {
    expect(parsePythonRequirement("-r base.txt")).toBeNull();
    expect(parsePythonRequirement("--index-url https://example.com")).toBeNull();
  });
});
