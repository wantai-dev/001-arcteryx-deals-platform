#!/usr/bin/env python3
"""Explicit local impact checks, change-tier classification and manually authorized dev -> main CI (stdlib only)."""
from __future__ import annotations

import argparse
import fnmatch
from functools import lru_cache
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")
SHA = re.compile(r"[0-9a-fA-F]{40}\Z")
RUNNERS = {"ubuntu-latest", "macos-14", "macos-15", "macos-26"}
# A step may name the one host platform it can run on. The hosted integration runner is Linux (macOS minutes bill at
# ten times the rate), so macOS-only steps are not run there: they are listed by name in the output, never counted as
# passed, and stay the job of a local `full` run on a Mac before the integration PR and of the nightly regression.
PLATFORMS = {"macos": "darwin"}
DEPENDENCIES = {
    "package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock",
    "pnpm-lock.yaml", "bun.lock", "bun.lockb", "pyproject.toml", "poetry.lock",
    "uv.lock", "Pipfile", "Pipfile.lock", "setup.py", "setup.cfg", "tox.ini",
    "go.mod", "go.sum", "Cargo.toml", "Cargo.lock", "Gemfile", "Gemfile.lock",
    "Podfile", "Podfile.lock", "Package.swift", "Package.resolved",
    "composer.json", "composer.lock", "build.gradle", "build.gradle.kts",
    "settings.gradle", "settings.gradle.kts", "gradle.properties", "pom.xml",
}
# Change-complexity tiers (global rule, 2026-11-18): L0 trivial -> lint only; L1 routine -> `changed`;
# L2 high risk -> `changed --keep-going` plus a local `full` before pushing dev. `classify` only reports a
# tier and suggests commands; it never runs a check. When in doubt it rounds up, never down.
CLASSIFY_DEFAULTS = {"l0_max_lines": 20, "l2_max_lines": 300, "l2_min_modules": 3}
CLASSIFY_KEYS = {"l0_paths", "l2_paths", "module_roots", *CLASSIFY_DEFAULTS}
# Built-in high-risk path categories every repository gets; `classify.l2_paths` adds repository-specific ones.
# Dependency manifests, lockfiles, workflows and the CI engine itself are L2 through affects_all().
DEFAULT_L2_PATHS = {
    "build-ci-config": [".github/**", "**/*.xcodeproj/**", "**/*.xcworkspace/**", "**/*.xcconfig",
                        "**/*.entitlements", "**/Info.plist", "**/*.xcprivacy", "**/Dockerfile",
                        "**/Dockerfile.*", "**/docker-compose*.yml", "**/docker-compose*.yaml", "**/Makefile"],
    "schema-migration": ["**/migrations/**", "**/alembic/**", "**/*.sql", "**/schema.prisma"],
}
# Line-comment prefixes by extension, used only to recognise a small single-file edit that touches no logic.
# A file type missing here can never be L0 through that route (it rounds up to L1).
_SLASH = ("//", "/*", "*", "*/")
COMMENT_PREFIXES = {
    **dict.fromkeys(("py", "sh", "bash", "zsh", "rb", "yml", "yaml", "toml", "cfg", "conf", "ini",
                     "gitignore"), ("#",)),
    **dict.fromkeys(("swift", "js", "mjs", "cjs", "ts", "tsx", "jsx", "java", "kt", "kts", "c", "h", "m",
                     "mm", "cc", "cpp", "hpp", "go", "rs", "css", "scss", "less", "gradle", "dart", "cs",
                     "php"), _SLASH),
    **dict.fromkeys(("html", "htm", "xml", "svg", "vue"), ("<!--", "-->")),
    **dict.fromkeys(("sql", "lua"), ("--",)),
}
# Cheap per-file syntax checks suggested for L0 (format/syntax/lint of the edited files only).
SYNTAX_CHECKS = {
    "py": ["python3", "-m", "py_compile"], "json": ["python3", "-m", "json.tool"],
    "js": ["node", "--check"], "mjs": ["node", "--check"], "cjs": ["node", "--check"],
    "sh": ["bash", "-n"], "bash": ["bash", "-n"], "zsh": ["zsh", "-n"], "swift": ["xcrun", "swiftc", "-parse"],
}


class CIError(Exception):
    pass


def run(argv: list[str], cwd: Path, *, capture: bool = False,
        env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    try:
        result = subprocess.run(argv, cwd=cwd, env=env, shell=False, text=True,
                                stdout=subprocess.PIPE if capture else None,
                                stderr=subprocess.PIPE if capture else None,
                                check=False)
    except OSError as exc:
        raise CIError(f"Cannot execute {argv[0]!r}: {exc}") from exc
    if result.returncode:
        detail = (result.stderr or result.stdout or "").strip() if capture else ""
        raise CIError(f"Command failed ({result.returncode}): {json.dumps(argv)} {detail}")
    return result


def relative_path(value: object, label: str, *, glob: bool = False) -> str:
    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value:
        raise CIError(f"{label} must be a nonempty repository-relative POSIX path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        raise CIError(f"{label} escapes the repository: {value!r}")
    if not glob and any(c in value for c in "*?["):
        raise CIError(f"{label} must not contain glob characters")
    return value


def command_spec(spec: object, label: str, root: Path) -> dict:
    if not isinstance(spec, dict):
        raise CIError(f"{label} must be an object")
    argv = spec.get("command")
    if not isinstance(argv, list) or not argv or any(
            not isinstance(arg, str) or "\x00" in arg for arg in argv) or not argv[0]:
        raise CIError(f"{label}.command must be a nonempty argv list of strings")
    cwd_value = relative_path(spec.get("cwd", "."), f"{label}.cwd")
    cwd = (root / cwd_value).resolve()
    if not cwd.is_relative_to(root) or not cwd.is_dir():
        raise CIError(f"{label}.cwd is missing or escapes the repository: {cwd_value!r}")
    platform = spec.get("platform")
    if platform is not None and platform not in PLATFORMS:
        raise CIError(f"{label}.platform must be one of {sorted(PLATFORMS)} when present")
    return {**spec, "command": argv, "cwd": cwd_value}


def runs_here(spec: dict, host: str | None = None) -> bool:
    platform = spec.get("platform")
    return platform is None or PLATFORMS[platform] == (host or sys.platform)


def load_manifest(root: Path) -> dict:
    try:
        data = json.loads((root / ".development-ci.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CIError(f"Cannot read .development-ci.json: {exc}") from exc
    if not isinstance(data, dict) or type(data.get("version")) is not int or data["version"] != 1:
        raise CIError(".development-ci.json must have version 1")
    if not isinstance(data.get("project"), str) or not REPOSITORY.fullmatch(data["project"]):
        raise CIError("manifest project must be owner/repo")
    if data.get("runner") not in RUNNERS:
        raise CIError(f"manifest runner must be one of {sorted(RUNNERS)}")
    for key in ("install", "checks", "notes"):
        if not isinstance(data.get(key), list):
            raise CIError(f"manifest {key} must be a list")
    if any(not isinstance(note, str) for note in data["notes"]):
        raise CIError("manifest notes must contain strings")
    data["install"] = [command_spec(item, f"install[{i}]", root)
                       for i, item in enumerate(data["install"])]
    checks = []
    seen = set()
    for i, item in enumerate(data["checks"]):
        item = command_spec(item, f"checks[{i}]", root)
        check_id = item.get("id")
        if not isinstance(check_id, str) or not check_id.strip() or check_id in seen:
            raise CIError(f"checks[{i}].id must be nonempty and unique")
        seen.add(check_id)
        patterns = item.get("paths")
        if not isinstance(patterns, list) or not patterns:
            raise CIError(f"checks[{i}].paths must be a nonempty list")
        for pattern in patterns:
            relative_path(pattern, f"checks[{i}].paths", glob=True)
        checks.append(item)
    data["checks"] = checks
    data["classify"] = classify_config(data.get("classify", {}))
    return data


def classify_config(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise CIError("manifest classify must be an object when present")
    unknown = sorted(set(raw) - CLASSIFY_KEYS)
    if unknown:
        raise CIError(f"manifest classify has unknown keys: {unknown}")

    def globs(value: object, label: str) -> list[str]:
        if not isinstance(value, list):
            raise CIError(f"{label} must be a list")
        return [relative_path(item, label, glob=True) for item in value]

    config = {key: raw.get(key, default) for key, default in CLASSIFY_DEFAULTS.items()}
    for key, value in config.items():
        if type(value) is not int or value < 1:
            raise CIError(f"manifest classify.{key} must be a positive integer")
    config["l0_paths"] = globs(raw.get("l0_paths", []), "classify.l0_paths")
    config["module_roots"] = globs(raw.get("module_roots", []), "classify.module_roots")
    extra = raw.get("l2_paths", {})
    if not isinstance(extra, dict):
        raise CIError("manifest classify.l2_paths must map a category name to a list of path patterns")
    categories = {name: list(patterns) for name, patterns in DEFAULT_L2_PATHS.items()}
    for name, patterns in extra.items():
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
            raise CIError(f"classify.l2_paths category must be kebab-case: {name!r}")
        categories.setdefault(name, []).extend(globs(patterns, f"classify.l2_paths.{name}"))
    config["l2_paths"] = categories
    return config


def git(root: Path, *args: str) -> str:
    return run(["git", "-C", str(root), *args], root, capture=True).stdout


def resolve_merge_base(root: Path, base: str) -> str:
    top = Path(git(root, "rev-parse", "--show-toplevel").strip()).resolve()
    if top != root:
        raise CIError("The engine must be installed in this repository's tools/ directory")
    # Resolve user refs before using them in diff; never treat a ref as an option.
    base_sha = git(root, "rev-parse", "--verify", "--end-of-options", base + "^{commit}").strip()
    return git(root, "merge-base", base_sha, "HEAD").strip()


def changed_paths(root: Path, base: str, merge_base: str | None = None) -> list[str]:
    merge_base = merge_base or resolve_merge_base(root, base)
    paths: set[str] = set()
    for args in (("diff", "--name-only", "-z", "--no-renames", merge_base, "HEAD", "--"),
                 ("diff", "--name-only", "-z", "--no-renames", "--cached", "--"),
                 ("diff", "--name-only", "-z", "--no-renames", "--"),
                 ("ls-files", "--others", "--exclude-standard", "-z")):
        paths.update(p for p in git(root, *args).split("\x00") if p)
    for path in paths:
        relative_path(path, "changed path", glob=True)
    return sorted(paths)


def affects_all(path: str) -> bool:
    name = PurePosixPath(path).name
    return (name in DEPENDENCIES or name.startswith("requirements") and name.endswith(".txt")
            or name.endswith(".lock") or path in {".development-ci.json", "tools/development_ci.py"}
            or path.startswith(".github/workflows/"))


def matches(path: str, pattern: str) -> bool:
    parts, patterns = PurePosixPath(path).parts, PurePosixPath(pattern).parts

    @lru_cache(maxsize=None)
    def visit(i: int, j: int) -> bool:
        if j == len(patterns):
            return i == len(parts)
        if patterns[j] == "**":
            return visit(i, j + 1) or i < len(parts) and visit(i + 1, j)
        return i < len(parts) and fnmatch.fnmatchcase(parts[i], patterns[j]) and visit(i + 1, j + 1)

    return visit(0, 0)


def select_checks(manifest: dict, paths: list[str]) -> list[dict]:
    if any(affects_all(path) for path in paths):
        return manifest["checks"]
    return [check for check in manifest["checks"]
            if any(matches(path, pattern) for path in paths for pattern in check["paths"])]


def documentation_only(path: str) -> bool:
    name = PurePosixPath(path).name.lower()
    return (path.startswith(("docs/", "doc/", ".agent/")) or name.endswith((".md", ".mdx", ".rst"))
            or name in {"readme", "license", "copying", "notice", "changelog"})


def unmapped_paths(manifest: dict, paths: list[str]) -> list[str]:
    return [path for path in paths if not documentation_only(path) and not affects_all(path)
            and not any(matches(path, pattern) for check in manifest["checks"] for pattern in check["paths"])]


def extension(path: str) -> str:
    name = PurePosixPath(path).name
    return name.rsplit(".", 1)[-1].lower() if "." in name else name.lower().lstrip(".")


def line_counts(root: Path, merge_base: str, paths: list[str]) -> dict[str, int | None]:
    """Added + deleted lines per path between the merge base and the working tree; None for binary files."""
    counts: dict[str, int | None] = {}
    for record in git(root, "diff", "--numstat", "-z", "--no-renames", merge_base, "--").split("\x00"):
        if record.count("\t") >= 2:
            added, deleted, path = record.split("\t", 2)
            counts[path] = None if "-" in (added, deleted) else int(added) + int(deleted)
    for path in paths:
        if path not in counts:  # untracked: every line is an addition
            text = untracked_text(root, path)
            counts[path] = None if text is None else len(text.splitlines())
    return counts


def untracked_text(root: Path, path: str) -> str | None:
    try:
        data = (root / path).read_bytes()
    except OSError:
        return None
    if b"\x00" in data:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def changed_lines(root: Path, merge_base: str, path: str) -> list[str] | None:
    """The added and removed line bodies of one path, or None when they cannot be read as text."""
    spec = ":(literal)" + path
    if not git(root, "ls-files", "-z", "--", spec) and not git(root, "ls-tree", "-z", "--name-only",
                                                               merge_base, "--", spec):
        text = untracked_text(root, path)
        return None if text is None else text.splitlines()
    lines, in_hunk = [], False
    for line in git(root, "diff", "-U0", "--no-renames", "--no-color", merge_base, "--", spec).splitlines():
        if line.startswith("@@"):
            in_hunk = True
        elif line.startswith("Binary files"):
            return None
        elif in_hunk and line[:1] in {"+", "-"}:
            lines.append(line[1:])
    return lines


def comment_only(path: str, lines: list[str] | None) -> bool:
    prefixes = COMMENT_PREFIXES.get(extension(path))
    if lines is None or not prefixes:
        return False
    for line in lines:
        body = line.strip()
        if body and (body.startswith("#!") or not body.startswith(prefixes)):
            return False
    return True


def module_of(path: str, roots: list[str]) -> str:
    """The longest configured module root that is a directory prefix of path, else its top-level directory."""
    parts = PurePosixPath(path).parts
    best: tuple[str, ...] = ()
    for root in roots:
        pattern = PurePosixPath(root).parts
        if len(parts) > len(pattern) > len(best) and all(
                fnmatch.fnmatchcase(part, piece) for part, piece in zip(parts, pattern)):
            best = parts[:len(pattern)]
    if best:
        return "/".join(best)
    return parts[0] if len(parts) > 1 else "(root)"


def classify(root: Path, manifest: dict, base: str) -> dict:
    config = manifest["classify"]
    merge_base = resolve_merge_base(root, base)
    paths = changed_paths(root, base, merge_base)
    counts = line_counts(root, merge_base, paths)
    trivial = [p for p in paths if documentation_only(p) or any(matches(p, g) for g in config["l0_paths"])]
    code = [p for p in paths if p not in trivial]
    code_lines = sum(counts.get(p) or 0 for p in code)
    unknown_size = [p for p in code if counts.get(p) is None]
    modules = sorted({module_of(p, config["module_roots"]) for p in code})
    reasons: list[dict] = []

    def reason(level: str, rule: str, detail: str, hit: list[str] | None = None) -> None:
        reasons.append({"level": level, "rule": rule, "detail": detail, **({"paths": hit} if hit else {})})

    engine = [p for p in paths if affects_all(p)]
    if engine:
        reason("L2", "dependency-or-ci-engine", "依赖清单/lockfile、CI workflow 或 CI 引擎与清单变更", engine)
    for category, patterns in config["l2_paths"].items():
        hit = [p for p in paths if p not in engine and any(matches(p, g) for g in patterns)]
        if hit:
            reason("L2", f"path:{category}", f"命中高风险路径类别 {category}", hit)
    if code_lines > config["l2_max_lines"]:
        reason("L2", "diff-size", f"非文档 diff 共 {code_lines} 行，超过 {config['l2_max_lines']} 行")
    if len(modules) >= config["l2_min_modules"]:
        reason("L2", "cross-module", f"跨 {len(modules)} 个模块（阈值 {config['l2_min_modules']}）：{', '.join(modules)}")
    if not any(item["level"] == "L2" for item in reasons):
        if not paths:
            reason("L0", "no-changes", "相对基线没有任何变更")
        elif not code:
            reason("L0", "docs-copy-or-test-data", "只改文档、注释类文件、文案或测试数据", trivial)
        elif (len(code) == 1 and counts.get(code[0]) is not None and counts[code[0]] <= config["l0_max_lines"]
              and comment_only(code[0], changed_lines(root, merge_base, code[0]))):
            reason("L0", "single-file-comment-only",
                   f"单文件 {counts[code[0]]} 行（≤{config['l0_max_lines']}）且只改注释或空行", code)
        elif len(code) == 1 and counts.get(code[0]) is not None and counts[code[0]] <= config["l0_max_lines"]:
            reason("L1", "small-logic-change",
                   f"单文件 {counts[code[0]]} 行但改动含代码逻辑（无法证明不涉逻辑，向上取级）", code)
        else:
            reason("L1", "routine", f"常规改动：{len(code)} 个非文档文件、{code_lines} 行、{len(modules)} 个模块", code)
    level = max(item["level"] for item in reasons)
    unmapped = unmapped_paths(manifest, paths)
    selected = [check["id"] for check in select_checks(manifest, paths)] if paths else []
    commands = suggested_commands(root, base, merge_base, level, paths)
    notes = []
    if unknown_size:
        notes.append("以下文件无法按文本计行（二进制或非 UTF-8），未计入 diff 行数：" + ", ".join(unknown_size))
    if unmapped and level != "L0":
        notes.append("存在未映射到任何检查的非文档路径，`changed` 会拒绝运行，先在 .development-ci.json "
                     "checks[].paths 里补映射：" + ", ".join(unmapped))
    if level == "L2":
        notes.append("集成批次含 L2：dev → main 集成 PR 需手动触发远端 CI；推 dev 前本机 full 必须全绿。")
    elif level == "L1":
        notes.append("L1：本批次若只含 L0/L1，以拟合入同一 SHA 的本机 full 全绿作 dev → main 门禁，不触发远端 CI。")
    return {"mode": "classify", "project": manifest["project"], "base": base, "merge_base": merge_base,
            "level": level, "reasons": reasons, "changed_paths": paths,
            "stats": {"files": len(paths), "trivial_files": len(trivial), "code_files": len(code),
                      "code_lines": code_lines, "modules": modules},
            "selected_checks": selected, "unmapped_paths": unmapped,
            "suggested_commands": commands, "notes": notes}


def suggested_commands(root: Path, base: str, merge_base: str, level: str, paths: list[str]) -> list[dict]:
    engine = ["python3", "tools/development_ci.py"]
    if level == "L2":
        return [{"command": engine + ["changed", "--base", base, "--keep-going"],
                 "why": "L2：跑全部受影响检查（含受影响构建）并汇总所有失败"},
                {"command": engine + ["full"], "why": "L2：推 dev 前本机 full，非 0 退出码不得报绿"}]
    if level == "L1":
        return [{"command": engine + ["changed", "--base", base], "why": "L1：跑受影响检查，首错即停"}]
    commands = [{"command": ["git", "diff", "--check", merge_base], "why": "L0：检查空白错误与冲突标记"}]
    for path in paths:
        checker = SYNTAX_CHECKS.get(extension(path))
        if checker and (root / path).is_file():
            commands.append({"command": checker + [path], "why": "L0：被改文件的语法检查"})
    return commands


def print_classification(result: dict) -> None:
    stats = result["stats"]
    print(f"改动级别：{result['level']}（基线 {result['base']}，merge-base {result['merge_base'][:12]}）")
    print(f"变更：{stats['files']} 个文件，其中非文档 {stats['code_files']} 个、{stats['code_lines']} 行；"
          f"模块：{', '.join(stats['modules']) or '无'}")
    print("判定依据：")
    for item in result["reasons"]:
        print(f"  [{item['level']}] {item['rule']}：{item['detail']}")
        for path in item.get("paths", [])[:10]:
            print(f"      - {path}")
        if len(item.get("paths", [])) > 10:
            print(f"      … 另 {len(item['paths']) - 10} 个")
    print("建议检查（classify 本身不运行任何检查）：")
    for item in result["suggested_commands"]:
        print(f"  $ {' '.join(item['command'])}    # {item['why']}")
    if result["selected_checks"]:
        print(f"`changed` 会选中的检查（{len(result['selected_checks'])} 个）：{', '.join(result['selected_checks'])}")
    for note in result["notes"]:
        print(f"注意：{note}")


def execution_environment(root: Path, steps: list[dict], *, install: bool, dry_run: bool) -> dict[str, str]:
    env = dict(os.environ)
    venv = root / ".local/development-ci/python"
    if not venv.resolve().is_relative_to(root):
        raise CIError("Managed Python environment escapes the repository")
    requires_pip = any(Path(spec["command"][0]).name in {"pip", "pip3"}
                       or any(spec["command"][i:i + 2] == ["-m", "pip"]
                              for i in range(len(spec["command"]) - 1)) for spec in steps)
    python = venv / "bin/python3"
    if install and requires_pip and not python.is_file():
        if dry_run:
            print(json.dumps({"managed_python": str(venv), "action": "would create isolated venv"}), flush=True)
        else:
            run([sys.executable, "-m", "venv", str(venv)], root)
    if python.is_file():
        if not (venv / "pyvenv.cfg").is_file():
            raise CIError("Managed Python environment lacks pyvenv.cfg")
        env["PATH"] = str(venv / "bin") + os.pathsep + env.get("PATH", "")
        env["VIRTUAL_ENV"] = str(venv)
        env.pop("PYTHONHOME", None)
    return env


def execute(root: Path, manifest: dict, args: argparse.Namespace) -> None:
    if args.mode == "full":
        checks = manifest["checks"]
        if not checks:
            raise CIError("Full regression is not configured: checks is empty; no validation was run")
        paths = None
    else:
        paths = changed_paths(root, args.base)
        checks = select_checks(manifest, paths)
        unmapped = unmapped_paths(manifest, paths)
        if unmapped or paths and not checks and any(not documentation_only(path) for path in paths):
            raise CIError("Unmapped non-documentation changes; configure affected checks.paths before validation: "
                          + json.dumps(unmapped or paths, ensure_ascii=False))
    host = getattr(args, "host_platform", None)
    not_run = [item["id"] for item in checks if not runs_here(item, host)]
    selected = [item["id"] for item in checks]
    checks = [item for item in checks if runs_here(item, host)]
    print(json.dumps({"mode": args.mode, "project": manifest["project"], "changed_paths": paths,
                      "selected_checks": selected, "not_run_on_this_host": not_run,
                      "dry_run": args.dry_run, "install": args.install}, ensure_ascii=False), flush=True)
    if not selected:
        print("No checks selected; no validation was run.", flush=True)
        return
    if not checks:
        raise CIError("Every selected check needs another host platform; no validation was run here: "
                      + json.dumps(not_run, ensure_ascii=False))
    install_steps = [item for item in manifest["install"] if runs_here(item, host)] if args.install else []
    steps = install_steps + checks
    env = execution_environment(root, steps, install=args.install, dry_run=args.dry_run)
    if getattr(args, "fail_fast", False):
        keep_going = False
    elif getattr(args, "keep_going", False):
        keep_going = True
    else:
        keep_going = args.mode == "full"
    for spec in install_steps:
        print(json.dumps({"step": spec.get("id", "install"), "cwd": spec["cwd"],
                          "command": spec["command"]}, ensure_ascii=False), flush=True)
        if not args.dry_run:
            run(spec["command"], (root / spec["cwd"]).resolve(), env=env)
    passed: list[str] = []
    failures: list[dict[str, str]] = []
    for spec in checks:
        print(json.dumps({"step": spec["id"], "cwd": spec["cwd"],
                          "command": spec["command"]}, ensure_ascii=False), flush=True)
        if not args.dry_run:
            try:
                run(spec["command"], (root / spec["cwd"]).resolve(), env=env)
            except CIError as exc:
                failures.append({"id": spec["id"], "error": str(exc)})
                print(json.dumps({"step_result": spec["id"], "status": "failed",
                                  "error": str(exc)}, ensure_ascii=False), flush=True)
                if not keep_going:
                    raise
            else:
                passed.append(spec["id"])
                print(json.dumps({"step_result": spec["id"], "status": "passed"},
                                 ensure_ascii=False), flush=True)
    if args.dry_run:
        print("Dry run complete; no install/check commands executed.", flush=True)
        return
    summary: dict = {"total": len(checks), "passed": len(passed), "failed": [item["id"] for item in failures]}
    if not_run:
        summary["not_run_on_this_host"] = not_run
    print(json.dumps({"check_summary": summary}, ensure_ascii=False), flush=True)
    if failures:
        failed_ids = ", ".join(item["id"] for item in failures)
        raise CIError(f"{len(failures)}/{len(checks)} check(s) failed: [{failed_ids}]")
    print(f"Completed {len(checks)} configured check(s)."
          + (f" {len(not_run)} check(s) need another host platform and were NOT run here: {', '.join(not_run)}."
             if not_run else ""), flush=True)


def gate(root: Path, manifest: dict, args: argparse.Namespace) -> None:
    if not REPOSITORY.fullmatch(args.repository) or not SHA.fullmatch(args.expected_sha):
        raise CIError("gate requires owner/repo and a 40-character hexadecimal expected SHA")
    if args.pr < 1:
        raise CIError("PR number must be positive")
    if manifest["project"].lower() != args.repository.lower():
        raise CIError("manifest project does not match the requested repository")
    response = run(["gh", "api", f"repos/{args.repository}/pulls/{args.pr}"], root, capture=True)
    try:
        pr = json.loads(response.stdout)
    except ValueError as exc:
        raise CIError("gh returned invalid PR JSON") from exc
    if not isinstance(pr, dict) or pr.get("state") != "open":
        raise CIError("Integration PR must currently be open")
    base, head = pr.get("base") or {}, pr.get("head") or {}
    if base.get("ref") != "main" or head.get("ref") != "dev":
        raise CIError("Only an open dev -> main integration PR is allowed")
    for label, branch in (("base", base), ("head", head)):
        repo = branch.get("repo") or {}
        if str(repo.get("full_name", "")).lower() != args.repository.lower():
            raise CIError(f"PR {label} repository must be {args.repository}; forks are not allowed")
    actual_sha = head.get("sha", "")
    if not isinstance(actual_sha, str) or not SHA.fullmatch(actual_sha) or actual_sha.lower() != args.expected_sha.lower():
        raise CIError("Expected SHA does not match the integration PR's current head SHA")
    outputs = {"sha": actual_sha.lower(), "runner": manifest["runner"]}
    print(json.dumps({"verified_pr": args.pr, "repository": args.repository, **outputs}), flush=True)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            for key, value in outputs.items():
                stream.write(f"{key}={value}\n")


def main(argv: list[str] | None = None, root: Path | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    for name in ("changed", "full"):
        mode = modes.add_parser(name)
        mode.add_argument("--dry-run", action="store_true")
        mode.add_argument("--install", action="store_true")
        group = mode.add_mutually_exclusive_group()
        group.add_argument("--keep-going", action="store_true",
                           help="Run all selected checks and report aggregate failures (default for full)")
        group.add_argument("--fail-fast", action="store_true",
                           help="Stop on the first failed check (default for changed)")
        if name == "changed":
            mode.add_argument("--base", default="origin/dev")
    mode = modes.add_parser("classify", help="Report the L0/L1/L2 change tier and suggested checks; runs no check")
    mode.add_argument("--base", default="origin/dev")
    mode.add_argument("--format", choices=("text", "json"), default="text")
    mode = modes.add_parser("gate")
    mode.add_argument("--repository", required=True)
    mode.add_argument("--pr", type=int, required=True)
    mode.add_argument("--expected-sha", required=True)
    args = parser.parse_args(argv)
    root = (root or Path(__file__).resolve().parent.parent).resolve()
    try:
        manifest = load_manifest(root)
        if args.mode == "gate":
            gate(root, manifest, args)
        elif args.mode == "classify":
            result = classify(root, manifest, args.base)
            if args.format == "json":
                print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
            else:
                print_classification(result)
        else:
            execute(root, manifest, args)
    except CIError as exc:
        print(f"development-ci: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
