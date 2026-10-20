#!/usr/bin/env python3
"""Explicit local impact checks and manually authorized dev -> main CI (stdlib only)."""
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
RUNNERS = {"ubuntu-latest", "macos-14"}
DEPENDENCIES = {
    "package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock",
    "pnpm-lock.yaml", "bun.lock", "bun.lockb", "pyproject.toml", "poetry.lock",
    "uv.lock", "Pipfile", "Pipfile.lock", "setup.py", "setup.cfg", "tox.ini",
    "go.mod", "go.sum", "Cargo.toml", "Cargo.lock", "Gemfile", "Gemfile.lock",
    "Podfile", "Podfile.lock", "Package.swift", "Package.resolved",
    "composer.json", "composer.lock", "build.gradle", "build.gradle.kts",
    "settings.gradle", "settings.gradle.kts", "gradle.properties", "pom.xml",
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
    return {**spec, "command": argv, "cwd": cwd_value}


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
    return data


def git(root: Path, *args: str) -> str:
    return run(["git", "-C", str(root), *args], root, capture=True).stdout


def changed_paths(root: Path, base: str) -> list[str]:
    top = Path(git(root, "rev-parse", "--show-toplevel").strip()).resolve()
    if top != root:
        raise CIError("The engine must be installed in this repository's tools/ directory")
    # Resolve user refs before using them in diff; never treat a ref as an option.
    base_sha = git(root, "rev-parse", "--verify", "--end-of-options", base + "^{commit}").strip()
    merge_base = git(root, "merge-base", base_sha, "HEAD").strip()
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
        unmapped = [path for path in paths if not documentation_only(path) and not affects_all(path)
                    and not any(matches(path, pattern) for check in manifest["checks"] for pattern in check["paths"])]
        if unmapped or paths and not checks and any(not documentation_only(path) for path in paths):
            raise CIError("Unmapped non-documentation changes; configure affected checks.paths before validation: "
                          + json.dumps(unmapped or paths, ensure_ascii=False))
    print(json.dumps({"mode": args.mode, "project": manifest["project"], "changed_paths": paths,
                      "selected_checks": [item["id"] for item in checks],
                      "dry_run": args.dry_run, "install": args.install}, ensure_ascii=False), flush=True)
    if not checks:
        print("No checks selected; no validation was run.", flush=True)
        return
    steps = (manifest["install"] if args.install else []) + checks
    env = execution_environment(root, steps, install=args.install, dry_run=args.dry_run)
    for spec in steps:
        print(json.dumps({"step": spec.get("id", "install"), "cwd": spec["cwd"],
                          "command": spec["command"]}, ensure_ascii=False), flush=True)
        if not args.dry_run:
            run(spec["command"], (root / spec["cwd"]).resolve(), env=env)
    print("Dry run complete; no install/check commands executed." if args.dry_run
          else f"Completed {len(checks)} configured check(s).", flush=True)


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
        if name == "changed":
            mode.add_argument("--base", default="origin/dev")
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
        else:
            execute(root, manifest, args)
    except CIError as exc:
        print(f"development-ci: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
