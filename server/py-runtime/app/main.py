import asyncio
import json
import os
import re
import tempfile
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_TITLE = "ZynqOS Remote Python Runtime"
DATA_ROOT = os.environ.get("DATA_ROOT", "/data/users")
API_KEY = os.environ.get("API_KEY", "")
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*")
DEFAULT_USER_ID = "default"
DEFAULT_ALLOWED_TOOLS = [
    "curl",
    "wget",
    "nmap",
    "dig",
    "nslookup",
    "traceroute",
    "git",
    "node",
    "npm",
    "pnpm",
    "apt",
    "apt-get",
]
DEFAULT_ALLOWED_APT_PACKAGES = [
    "curl",
    "wget",
    "nmap",
    "dnsutils",
    "traceroute",
    "git",
    "nodejs",
    "npm",
    "wireshark",
]


def _parse_allowlist(raw: str, fallback: List[str]) -> List[str]:
    values = [v.strip() for v in raw.split(",") if v.strip()]
    if values:
        return values
    return fallback


ALLOWED_TOOLS = set(
    v.lower()
    for v in _parse_allowlist(os.environ.get("ALLOWED_TOOLS", ""), DEFAULT_ALLOWED_TOOLS)
)
ALLOWED_APT_PACKAGES = set(
    v.lower()
    for v in _parse_allowlist(os.environ.get("ALLOWED_APT_PACKAGES", ""), DEFAULT_ALLOWED_APT_PACKAGES)
)

app = FastAPI(title=APP_TITLE)

allowed_origins = [o.strip() for o in ALLOWED_ORIGINS.split(",") if o.strip()]
if not allowed_origins:
    allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_venv_lock = asyncio.Lock()


def _normalize_user_id(raw: Optional[str]) -> str:
    if not raw:
        return DEFAULT_USER_ID
    value = raw.strip()
    if not value:
        return DEFAULT_USER_ID
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", value):
        raise HTTPException(status_code=400, detail="Invalid user id")
    return value


def _get_user_dirs(user_id: str) -> Dict[str, str]:
    root = os.path.join(DATA_ROOT, user_id)
    home = os.path.join(root, "home")
    venv = os.path.join(root, "venv")
    tmp = os.path.join(root, ".tmp")
    bin_dir = os.path.join(root, "bin")
    npm_dir = os.path.join(root, "npm")
    return {
        "root": root,
        "home": home,
        "venv": venv,
        "tmp": tmp,
        "bin": bin_dir,
        "npm": npm_dir,
    }


def _ensure_dirs(paths: Dict[str, str]) -> None:
    os.makedirs(paths["home"], exist_ok=True)
    os.makedirs(paths["tmp"], exist_ok=True)
    os.makedirs(paths["bin"], exist_ok=True)
    os.makedirs(paths["npm"], exist_ok=True)
    os.makedirs(os.path.join(paths["npm"], "bin"), exist_ok=True)


def _resolve_home_path(home: str, rel_path: str) -> str:
    rel = rel_path.strip()
    if rel.startswith("/"):
        rel = rel[1:]
    home_abs = os.path.abspath(home)
    full = os.path.abspath(os.path.normpath(os.path.join(home_abs, rel)))
    if os.path.commonpath([home_abs, full]) != home_abs:
        raise HTTPException(status_code=400, detail="Path escapes home")
    return full


def _get_venv_python(venv_dir: str) -> str:
    return os.path.join(venv_dir, "bin", "python")


async def _ensure_venv(paths: Dict[str, str]) -> str:
    venv_dir = paths["venv"]
    venv_python = _get_venv_python(venv_dir)
    if os.path.exists(venv_python):
        return venv_python

    async with _venv_lock:
        if os.path.exists(venv_python):
            return venv_python
        os.makedirs(paths["root"], exist_ok=True)
        _ensure_dirs(paths)
        proc = await asyncio.create_subprocess_exec(
            "python",
            "-m",
            "venv",
            venv_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create venv: {stderr.decode(errors='ignore')}",
            )
    return venv_python


def _require_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    if not API_KEY:
        return
    if not x_api_key or x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


def _build_tool_env(paths: Dict[str, str], extra_env: Dict[str, str]) -> Dict[str, str]:
    env = os.environ.copy()
    env.update(extra_env or {})
    npm_bin = os.path.join(paths["npm"], "bin")
    user_bin = paths["bin"]
    existing_path = env.get("PATH", "")
    env["PATH"] = ":".join([user_bin, npm_bin, existing_path])
    env["HOME"] = paths["home"]
    env["NPM_CONFIG_PREFIX"] = paths["npm"]
    env["PNPM_HOME"] = npm_bin
    env["PNPM_STORE_DIR"] = os.path.join(paths["npm"], "store")
    return env



class RunRequest(BaseModel):
    code: str = Field(..., min_length=1)
    cwd: Optional[str] = None
    args: List[str] = Field(default_factory=list)
    timeout_s: float = Field(default=20.0, ge=1.0, le=120.0)
    env: Dict[str, str] = Field(default_factory=dict)


class RunResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool


class PipInstallRequest(BaseModel):
    packages: List[str] = Field(..., min_items=1)
    upgrade: bool = False


class PipListResponse(BaseModel):
    packages: List[Dict[str, str]]


class FsWriteRequest(BaseModel):
    path: str
    content: str
    encoding: str = "utf-8"
    mkdirs: bool = True


class FsReadResponse(BaseModel):
    path: str
    content: str
    encoding: str
    size: int


class FsListResponse(BaseModel):
    path: str
    entries: List[Dict[str, str]]


class FsDeleteRequest(BaseModel):
    path: str


class ToolRunRequest(BaseModel):
    command: str = Field(..., min_length=1)
    args: List[str] = Field(default_factory=list)
    cwd: Optional[str] = None
    timeout_s: float = Field(default=30.0, ge=1.0, le=120.0)
    env: Dict[str, str] = Field(default_factory=dict)


class ToolInstallRequest(BaseModel):
    manager: str = Field(default="apt")
    packages: List[str] = Field(..., min_items=1)


class ToolsListResponse(BaseModel):
    tools: List[str]
    apt_packages: List[str]


async def _run_command(
    cmd: List[str],
    cwd: str,
    env: Dict[str, str],
    timeout_s: float,
) -> RunResponse:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    timed_out = False
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        timed_out = True
        proc.kill()
        stdout, stderr = await proc.communicate()
    max_bytes = 2 * 1024 * 1024
    out = (stdout or b"")[:max_bytes].decode(errors="ignore")
    err = (stderr or b"")[:max_bytes].decode(errors="ignore")
    return RunResponse(
        stdout=out,
        stderr=err,
        exit_code=proc.returncode if proc.returncode is not None else -1,
        timed_out=timed_out,
    )


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/python/version")
async def python_version(
    _: None = Depends(_require_api_key),
    x_user_id: Optional[str] = Header(default=None),
) -> Dict[str, str]:
    user_id = _normalize_user_id(x_user_id)
    paths = _get_user_dirs(user_id)
    _ensure_dirs(paths)
    venv_python = await _ensure_venv(paths)
    resp = await _run_command(
        [venv_python, "-c", "import sys; print(sys.version)"],
        cwd=paths["home"],
        env=os.environ.copy(),
        timeout_s=10.0,
    )
    return {"version": resp.stdout.strip()}


@app.post("/v1/run", response_model=RunResponse)
async def run_code(
    payload: RunRequest,
    _: None = Depends(_require_api_key),
    x_user_id: Optional[str] = Header(default=None),
) -> RunResponse:
    user_id = _normalize_user_id(x_user_id)
    paths = _get_user_dirs(user_id)
    _ensure_dirs(paths)
    venv_python = await _ensure_venv(paths)
    cwd = paths["home"]
    if payload.cwd:
        cwd = _resolve_home_path(paths["home"], payload.cwd)
        os.makedirs(cwd, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".py",
        delete=False,
        dir=paths["tmp"],
        encoding="utf-8",
    ) as handle:
        handle.write(payload.code)
        script_path = handle.name

    env = os.environ.copy()
    env.update(payload.env or {})
    env["PYTHONUNBUFFERED"] = "1"

    try:
        cmd = [venv_python, script_path] + list(payload.args or [])
        return await _run_command(cmd, cwd=cwd, env=env, timeout_s=payload.timeout_s)
    finally:
        try:
            os.remove(script_path)
        except OSError:
            pass


@app.post("/v1/pip/install", response_model=RunResponse)
async def pip_install(
    payload: PipInstallRequest,
    _: None = Depends(_require_api_key),
    x_user_id: Optional[str] = Header(default=None),
) -> RunResponse:
    user_id = _normalize_user_id(x_user_id)
    paths = _get_user_dirs(user_id)
    _ensure_dirs(paths)
    venv_python = await _ensure_venv(paths)

    cmd = [
        venv_python,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
    ]
    if payload.upgrade:
        cmd.append("--upgrade")
    cmd.extend(payload.packages)

    return await _run_command(cmd, cwd=paths["home"], env=os.environ.copy(), timeout_s=120.0)


@app.get("/v1/pip/list", response_model=PipListResponse)
async def pip_list(
    _: None = Depends(_require_api_key),
    x_user_id: Optional[str] = Header(default=None),
) -> PipListResponse:
    user_id = _normalize_user_id(x_user_id)
    paths = _get_user_dirs(user_id)
    _ensure_dirs(paths)
    venv_python = await _ensure_venv(paths)

    resp = await _run_command(
        [venv_python, "-m", "pip", "list", "--format=json"],
        cwd=paths["home"],
        env=os.environ.copy(),
        timeout_s=30.0,
    )
    try:
        packages = json.loads(resp.stdout or "[]")
    except json.JSONDecodeError:
        packages = []
    return PipListResponse(packages=packages)


@app.post("/v1/fs/write")
async def fs_write(
    payload: FsWriteRequest,
    _: None = Depends(_require_api_key),
    x_user_id: Optional[str] = Header(default=None),
) -> Dict[str, str]:
    user_id = _normalize_user_id(x_user_id)
    paths = _get_user_dirs(user_id)
    _ensure_dirs(paths)
    target = _resolve_home_path(paths["home"], payload.path)
    parent = os.path.dirname(target)
    if payload.mkdirs:
        os.makedirs(parent, exist_ok=True)

    if payload.encoding == "base64":
        import base64
        try:
            content = base64.b64decode(payload.content.encode("utf-8"), validate=True)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid base64: {exc}")
        with open(target, "wb") as handle:
            handle.write(content)
    elif payload.encoding == "utf-8":
        with open(target, "w", encoding="utf-8") as handle:
            handle.write(payload.content)
    else:
        raise HTTPException(status_code=400, detail="Unsupported encoding")

    return {"status": "ok"}


@app.get("/v1/fs/read", response_model=FsReadResponse)
async def fs_read(
    path: str,
    encoding: str = "utf-8",
    _: None = Depends(_require_api_key),
    x_user_id: Optional[str] = Header(default=None),
) -> FsReadResponse:
    user_id = _normalize_user_id(x_user_id)
    paths = _get_user_dirs(user_id)
    _ensure_dirs(paths)
    target = _resolve_home_path(paths["home"], path)

    if not os.path.exists(target):
        raise HTTPException(status_code=404, detail="File not found")

    if encoding == "base64":
        import base64
        with open(target, "rb") as handle:
            raw = handle.read()
        return FsReadResponse(
            path=path,
            content=base64.b64encode(raw).decode("utf-8"),
            encoding="base64",
            size=len(raw),
        )

    if encoding != "utf-8":
        raise HTTPException(status_code=400, detail="Unsupported encoding")

    with open(target, "r", encoding="utf-8", errors="ignore") as handle:
        data = handle.read()
    return FsReadResponse(path=path, content=data, encoding="utf-8", size=len(data))


@app.get("/v1/fs/list", response_model=FsListResponse)
async def fs_list(
    path: str = "",
    _: None = Depends(_require_api_key),
    x_user_id: Optional[str] = Header(default=None),
) -> FsListResponse:
    user_id = _normalize_user_id(x_user_id)
    paths = _get_user_dirs(user_id)
    _ensure_dirs(paths)
    target = _resolve_home_path(paths["home"], path)

    if not os.path.exists(target):
        raise HTTPException(status_code=404, detail="Path not found")

    entries: List[Dict[str, str]] = []
    if os.path.isfile(target):
        entries.append({
            "name": os.path.basename(target),
            "type": "file",
            "size": str(os.path.getsize(target)),
        })
    else:
        for name in sorted(os.listdir(target)):
            full = os.path.join(target, name)
            entry_type = "dir" if os.path.isdir(full) else "file"
            size = str(os.path.getsize(full)) if entry_type == "file" else "0"
            entries.append({"name": name, "type": entry_type, "size": size})

    return FsListResponse(path=path, entries=entries)


@app.post("/v1/fs/delete")
async def fs_delete(
    payload: FsDeleteRequest,
    _: None = Depends(_require_api_key),
    x_user_id: Optional[str] = Header(default=None),
) -> Dict[str, str]:
    user_id = _normalize_user_id(x_user_id)
    paths = _get_user_dirs(user_id)
    _ensure_dirs(paths)
    target = _resolve_home_path(paths["home"], payload.path)

    if not os.path.exists(target):
        return {"status": "missing"}
    if os.path.isdir(target):
        for root, dirs, files in os.walk(target, topdown=False):
            for fname in files:
                try:
                    os.remove(os.path.join(root, fname))
                except OSError:
                    pass
            for dname in dirs:
                try:
                    os.rmdir(os.path.join(root, dname))
                except OSError:
                    pass
        try:
            os.rmdir(target)
        except OSError:
            pass
    else:
        os.remove(target)
    return {"status": "ok"}


@app.get("/v1/tools/list", response_model=ToolsListResponse)
async def tools_list(
    _: None = Depends(_require_api_key),
) -> ToolsListResponse:
    return ToolsListResponse(
        tools=sorted(ALLOWED_TOOLS),
        apt_packages=sorted(ALLOWED_APT_PACKAGES),
    )


@app.post("/v1/tools/run", response_model=RunResponse)
async def tools_run(
    payload: ToolRunRequest,
    _: None = Depends(_require_api_key),
    x_user_id: Optional[str] = Header(default=None),
) -> RunResponse:
    user_id = _normalize_user_id(x_user_id)
    paths = _get_user_dirs(user_id)
    _ensure_dirs(paths)

    cmd = payload.command.strip()
    if not cmd:
        raise HTTPException(status_code=400, detail="Missing command")

    cmd_lower = cmd.lower()
    if cmd_lower not in ALLOWED_TOOLS:
        allowed_list = ", ".join(sorted(ALLOWED_TOOLS))
        raise HTTPException(status_code=403, detail=f"Command not allowed. Allowed tools: {allowed_list}")
    if cmd_lower in {"apt", "apt-get"}:
        raise HTTPException(status_code=400, detail="Use /v1/tools/install for apt installs")

    cwd = paths["home"]
    if payload.cwd:
        cwd = _resolve_home_path(paths["home"], payload.cwd)
        os.makedirs(cwd, exist_ok=True)

    env = _build_tool_env(paths, payload.env or {})
    cmd_list = [cmd_lower] + list(payload.args or [])
    return await _run_command(cmd_list, cwd=cwd, env=env, timeout_s=payload.timeout_s)


@app.post("/v1/tools/install", response_model=RunResponse)
async def tools_install(
    payload: ToolInstallRequest,
    _: None = Depends(_require_api_key),
    x_user_id: Optional[str] = Header(default=None),
) -> RunResponse:
    manager = (payload.manager or "").strip().lower()
    if manager != "apt":
        raise HTTPException(status_code=400, detail="Only apt manager is supported")

    packages: List[str] = []
    for raw in payload.packages:
        value = raw.strip().lower()
        if not value:
            continue
        if not re.fullmatch(r"[a-z0-9+._-]+", value):
            raise HTTPException(status_code=400, detail=f"Invalid package name: {raw}")
        if value not in ALLOWED_APT_PACKAGES:
            allowed_list = ", ".join(sorted(ALLOWED_APT_PACKAGES))
            raise HTTPException(status_code=403, detail=f"Package not allowed: {raw}. Allowed packages: {allowed_list}")
        packages.append(value)

    if not packages:
        raise HTTPException(status_code=400, detail="No packages to install")

    user_id = _normalize_user_id(x_user_id)
    paths = _get_user_dirs(user_id)
    _ensure_dirs(paths)

    env = _build_tool_env(paths, {})
    update_resp = await _run_command(
        ["apt-get", "update"],
        cwd=paths["home"],
        env=env,
        timeout_s=120.0,
    )
    if update_resp.exit_code != 0:
        return update_resp

    install_cmd = ["apt-get", "install", "-y", "--no-install-recommends"] + packages
    install_resp = await _run_command(
        install_cmd,
        cwd=paths["home"],
        env=env,
        timeout_s=120.0,
    )
    if update_resp.stdout:
        install_resp.stdout = update_resp.stdout + "\n" + install_resp.stdout
    if update_resp.stderr:
        install_resp.stderr = update_resp.stderr + "\n" + install_resp.stderr
    return install_resp
