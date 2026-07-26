#!/usr/bin/env python3

"""Minimal privileged HTTPS helper for a production LiveBoard host."""

from __future__ import annotations

import argparse
import fcntl
import ipaddress
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STATE_DIR = Path(os.environ.get("LIVEBOARD_STATE_DIR", "/opt/liveboard"))
HTTPS_DIR = Path(os.environ.get("LIVEBOARD_HTTPS_DIR", STATE_DIR / "https"))
RUN_DIR = Path(os.environ.get("LIVEBOARD_RUN_DIR", "/run/liveboard"))
SOCKET_PATH = Path(
    os.environ.get("LIVEBOARD_HTTPS_SOCKET", RUN_DIR / "https-agent.sock")
)
ENV_FILE = Path(os.environ.get("LIVEBOARD_ENV_FILE", STATE_DIR / ".env"))
INSTALL_CONF = Path(
    os.environ.get("LIVEBOARD_INSTALL_CONF", STATE_DIR / "install.conf")
)
ACTIVE_LINK = Path(
    os.environ.get("LIVEBOARD_ACTIVE_RELEASE", STATE_DIR / "releases/active")
)
NGINX_SITE = Path(
    os.environ.get(
        "LIVEBOARD_NGINX_SITE", "/etc/nginx/sites-available/liveboard"
    )
)
LEGO_BIN = Path(os.environ.get("LIVEBOARD_LEGO_BIN", STATE_DIR / "bin/lego"))
CONFIG_FILE = HTTPS_DIR / "config.json"
LAST_ERROR_FILE = HTTPS_DIR / "last-error.txt"
LOCK_FILE = HTTPS_DIR / ".lock"
WEBROOT = HTTPS_DIR / "webroot"
LEGO_PATH = HTTPS_DIR / "lego"
API_SOCKET_GID = int(os.environ.get("LIVEBOARD_API_SOCKET_GID", "1000"))
DOMAIN_PATTERN = re.compile(
    r"(?=^.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"
)
EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}$")
HTTP_CHALLENGE = "http-01"
TLS_ALPN_CHALLENGE = "tls-alpn-01"
DOMAIN_SUBJECT = "domain"
IP_SUBJECT = "ip"
SHORTLIVED_PROFILE = "shortlived"


class HttpsError(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_write(path: Path, content: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def run(
    arguments: list[str],
    *,
    timeout: int = 180,
    check: bool = True,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        arguments,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        env=env,
    )
    if check and completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise HttpsError(detail[-1200:] or f"命令执行失败：{arguments[0]}")
    return completed


def require_command(command: str) -> str:
    resolved = shutil.which(command)
    if not resolved:
        raise HttpsError(f"服务器缺少 HTTPS 依赖：{command}")
    return resolved


def normalize_domain(value: str) -> str:
    domain = value.strip().rstrip(".").lower()
    if not DOMAIN_PATTERN.fullmatch(domain):
        raise HttpsError("请输入有效的完整域名，例如 board.example.com")
    return domain


def normalize_subject(value: str) -> tuple[str, str]:
    subject = value.strip().rstrip(".").lower()
    try:
        address = ipaddress.ip_address(subject)
    except ValueError:
        return normalize_domain(subject), DOMAIN_SUBJECT
    if address.version != 4 or not address.is_global:
        raise HttpsError("IP HTTPS 目前只支持可从公网访问的 IPv4 地址")
    return str(address), IP_SUBJECT


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if not EMAIL_PATTERN.fullmatch(email):
        raise HttpsError("请输入有效的证书通知邮箱")
    return email


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def save_config(config: dict[str, Any]) -> None:
    atomic_write(
        CONFIG_FILE,
        json.dumps(config, ensure_ascii=False, indent=2) + "\n",
    )


def certificate_paths(domain: str) -> tuple[Path, Path]:
    directory = LEGO_PATH / "certificates"
    return directory / f"{domain}.crt", directory / f"{domain}.key"


def certificate_expiry(certificate: Path) -> str | None:
    if not certificate.is_file():
        return None
    try:
        decoded = ssl._ssl._test_decode_cert(str(certificate))  # type: ignore[attr-defined]
        raw = decoded.get("notAfter")
        if not isinstance(raw, str):
            return None
        parsed = datetime.strptime(raw, "%b %d %H:%M:%S %Y %Z")
        return parsed.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    except (OSError, ValueError, ssl.SSLError):
        return None


def read_env() -> list[str]:
    if not ENV_FILE.is_file():
        raise HttpsError(f"缺少生产配置：{ENV_FILE}")
    return ENV_FILE.read_text(encoding="utf-8").splitlines()


def update_env_values(values: dict[str, str]) -> None:
    lines = read_env()
    remaining = dict(values)
    output: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0] if "=" in line else ""
        if key in remaining:
            output.append(f"{key}={remaining.pop(key)}")
        else:
            output.append(line)
    output.extend(f"{key}={value}" for key, value in remaining.items())
    atomic_write(ENV_FILE, "\n".join(output) + "\n")


def update_key_value_file(path: Path, values: dict[str, str]) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
    remaining = dict(values)
    output: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0] if "=" in line else ""
        if key in remaining:
            output.append(f"{key}={remaining.pop(key)}")
        else:
            output.append(line)
    output.extend(f"{key}={value}" for key, value in remaining.items())
    atomic_write(path, "\n".join(output) + "\n")


def nginx_proxy_locations() -> str:
    return """\
  client_max_body_size 100m;

  location ^~ /.well-known/acme-challenge/ {
    root %s;
    default_type text/plain;
    try_files $uri =404;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:4000/;
    proxy_buffering off;
    proxy_read_timeout 480s;
    proxy_send_timeout 480s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
""" % WEBROOT


def http_nginx_config(domain: str) -> str:
    return """\
# Managed by LiveBoard
server {
  listen 80;
  server_name %s;

%s}
""" % (domain, nginx_proxy_locations())


def https_nginx_config(domain: str, certificate: Path, key: Path) -> str:
    return """\
# Managed by LiveBoard
server {
  listen 80;
  server_name %s;

  location ^~ /.well-known/acme-challenge/ {
    root %s;
    default_type text/plain;
    try_files $uri =404;
  }

  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl;
  server_name %s;

  ssl_certificate %s;
  ssl_certificate_key %s;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_cache shared:LiveBoardTLS:10m;
  ssl_session_timeout 1d;

  add_header X-Content-Type-Options "nosniff" always;

%s}
""" % (
        domain,
        WEBROOT,
        domain,
        certificate,
        key,
        nginx_proxy_locations(),
    )


def install_nginx_config(content: str) -> None:
    atomic_write(NGINX_SITE, content, mode=0o644)
    run([require_command("nginx"), "-t"], timeout=30)
    run([require_command("systemctl"), "reload", "nginx"], timeout=30)


def check_http_challenge(domain: str) -> None:
    if os.environ.get("LIVEBOARD_SKIP_PUBLIC_CHALLENGE_CHECK") == "1":
        return
    if os.environ.get("LIVEBOARD_TEST_PUBLIC_CHALLENGE_FAILURE") == "1":
        raise HttpsError("无法通过公网域名访问 HTTP 验证路径")
    token = f"liveboard-{os.urandom(12).hex()}"
    challenge_directory = WEBROOT / ".well-known/acme-challenge"
    challenge_directory.mkdir(parents=True, exist_ok=True)
    target = challenge_directory / token
    target.write_text(token, encoding="utf-8")
    try:
        request = urllib.request.Request(
            f"http://{domain}/.well-known/acme-challenge/{token}",
            headers={"User-Agent": "LiveBoard-HTTPS-Check/1"},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read(512).decode("utf-8").strip()
        if body != token:
            raise HttpsError("域名可以访问，但 ACME 验证路径返回了错误内容")
    except HttpsError:
        raise
    except Exception as caught:
        raise HttpsError(
            "无法通过公网域名访问 HTTP 验证路径；请检查 DNS、代理设置和 TCP 80"
        ) from caught
    finally:
        target.unlink(missing_ok=True)


def select_challenge_type(domain: str) -> tuple[str, str | None]:
    forced = os.environ.get("LIVEBOARD_ACME_CHALLENGE", "auto").strip().lower()
    if forced == HTTP_CHALLENGE:
        check_http_challenge(domain)
        return HTTP_CHALLENGE, None
    if forced == TLS_ALPN_CHALLENGE:
        return TLS_ALPN_CHALLENGE, None
    if forced != "auto":
        raise HttpsError(
            "LIVEBOARD_ACME_CHALLENGE 只支持 auto、http-01 或 tls-alpn-01"
        )
    try:
        check_http_challenge(domain)
        return HTTP_CHALLENGE, None
    except HttpsError as caught:
        return TLS_ALPN_CHALLENGE, str(caught)


def lego_arguments(
    subject: str,
    email: str,
    action: str,
    challenge_type: str,
    subject_type: str,
) -> list[str]:
    arguments = [
        str(LEGO_BIN),
        "run",
        "--path",
        str(LEGO_PATH),
        "--email",
        email,
        "--accept-tos",
        "--domains",
        subject,
    ]
    if subject_type == IP_SUBJECT:
        arguments.extend(["--profile", SHORTLIVED_PROFILE])
    if challenge_type == HTTP_CHALLENGE:
        arguments.extend(["--http", "--http.webroot", str(WEBROOT)])
    elif challenge_type == TLS_ALPN_CHALLENGE:
        arguments.append("--tls")
    else:
        raise HttpsError(f"不支持的 ACME 验证方式：{challenge_type}")
    if action == "renew":
        renew_days = "3" if subject_type == IP_SUBJECT else "30"
        arguments.extend(["--renew-days", renew_days, "--no-random-sleep"])
    elif action != "run":
        raise HttpsError(f"不支持的证书操作：{action}")
    return arguments


def snapshot_file(path: Path) -> tuple[bytes, int] | None:
    if not path.is_file():
        return None
    return path.read_bytes(), path.stat().st_mode & 0o777


def restore_file(path: Path, snapshot: tuple[bytes, int] | None) -> None:
    if snapshot is None:
        path.unlink(missing_ok=True)
        return
    content, mode = snapshot
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def wait_for_tls_challenge_port(timeout: int = 15) -> None:
    if os.environ.get("LIVEBOARD_SKIP_TLS_PORT_CHECK") == "1":
        return
    deadline = time.monotonic() + timeout
    while True:
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            probe.bind(("0.0.0.0", 443))
            return
        except OSError as caught:
            if time.monotonic() >= deadline:
                raise HttpsError(
                    "无法释放 TCP 443 供 TLS-ALPN 验证使用；"
                    "请检查是否有其他程序占用 443"
                ) from caught
            time.sleep(0.5)
        finally:
            probe.close()


def verify_local_https(subject: str) -> None:
    _, subject_type = normalize_subject(subject)
    arguments = [
        require_command("curl"),
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "15",
    ]
    if subject_type == IP_SUBJECT:
        arguments.extend(
            ["--connect-to", f"{subject}:443:127.0.0.1:443"]
        )
    else:
        arguments.extend(["--resolve", f"{subject}:443:127.0.0.1"])
    arguments.append(f"https://{subject}/")
    run(arguments, timeout=20)


def schedule_runtime_apply() -> None:
    if os.environ.get("LIVEBOARD_SKIP_RUNTIME_RECREATE") == "1":
        return
    subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "apply-runtime"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
        env=os.environ.copy(),
    )


def compose_environment(release: Path) -> dict[str, str]:
    environment = os.environ.copy()
    manifest = release / "manifest.txt"
    version = ""
    if manifest.is_file():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            if line.startswith("release="):
                version = line.split("=", 1)[1].strip()
                break
    if version:
        environment["LIVEBOARD_API_IMAGE"] = f"liveboard-api:{version}"
        environment["LIVEBOARD_WEB_IMAGE"] = f"liveboard-web:{version}"
    return environment


def apply_runtime() -> None:
    time.sleep(3)
    try:
        release = ACTIVE_LINK.resolve(strict=True)
        compose_file = release / "docker-compose.yml"
        run(
            [
                require_command("docker"),
                "compose",
                "--project-name",
                "liveboard",
                "--project-directory",
                str(release),
                "--file",
                str(compose_file),
                "up",
                "-d",
                "--no-build",
                "--force-recreate",
                "api",
                "web",
            ],
            timeout=180,
            env=compose_environment(release),
        )
        LAST_ERROR_FILE.unlink(missing_ok=True)
    except Exception as caught:
        atomic_write(
            LAST_ERROR_FILE,
            f"{now_iso()} 重新载入应用环境失败：{caught}\n",
        )


@contextmanager
def operation_lock():
    HTTPS_DIR.mkdir(parents=True, exist_ok=True)
    with LOCK_FILE.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield


def enable_https(domain_value: str, email_value: str) -> dict[str, Any]:
    subject, subject_type = normalize_subject(domain_value)
    email = normalize_email(email_value)
    if not LEGO_BIN.is_file() or not os.access(LEGO_BIN, os.X_OK):
        raise HttpsError("当前发布包缺少 ACME 客户端，请先升级 LiveBoard")
    if not NGINX_SITE.is_file():
        raise HttpsError("找不到 LiveBoard Nginx 配置")

    with operation_lock():
        HTTPS_DIR.mkdir(parents=True, exist_ok=True)
        WEBROOT.mkdir(parents=True, exist_ok=True)
        LEGO_PATH.mkdir(parents=True, exist_ok=True)
        original_nginx = NGINX_SITE.read_text(encoding="utf-8")
        original_env = ENV_FILE.read_text(encoding="utf-8")
        original_install_conf = (
            INSTALL_CONF.read_text(encoding="utf-8")
            if INSTALL_CONF.is_file()
            else None
        )
        certificate, key = certificate_paths(subject)
        original_certificate = snapshot_file(certificate)
        original_key = snapshot_file(key)
        try:
            install_nginx_config(http_nginx_config(subject))
            challenge_type, http_failure = select_challenge_type(subject)
            if challenge_type == TLS_ALPN_CHALLENGE:
                wait_for_tls_challenge_port()
            try:
                run(
                    lego_arguments(
                        subject,
                        email,
                        "run",
                        challenge_type,
                        subject_type,
                    ),
                    timeout=240,
                )
            except HttpsError as caught:
                if challenge_type == HTTP_CHALLENGE:
                    http_failure = f"HTTP-01 证书签发失败：{caught}"
                    challenge_type = TLS_ALPN_CHALLENGE
                    wait_for_tls_challenge_port()
                    try:
                        run(
                            lego_arguments(
                                subject,
                                email,
                                "run",
                                challenge_type,
                                subject_type,
                            ),
                            timeout=240,
                        )
                    except HttpsError as tls_caught:
                        raise HttpsError(
                            f"{http_failure}；已自动改用 TCP 443 的 TLS-ALPN "
                            f"验证，但仍然失败：{tls_caught}"
                        ) from tls_caught
                elif http_failure:
                    raise HttpsError(
                        f"{http_failure}；已自动改用 TCP 443 的 TLS-ALPN 验证，"
                        f"但仍然失败：{caught}"
                    ) from caught
                else:
                    raise
            if not certificate.is_file() or not key.is_file():
                raise HttpsError("证书机构返回成功，但没有找到证书文件")
            os.chmod(key, 0o600)
            install_nginx_config(
                https_nginx_config(subject, certificate, key)
            )
            verify_local_https(subject)
            update_env_values(
                {
                    "SESSION_COOKIE_SECURE": "true",
                    "WEB_ORIGIN": f"https://{subject}",
                }
            )
            update_key_value_file(
                INSTALL_CONF,
                {
                    "ACCESS_MODE": (
                        "https-ip"
                        if subject_type == IP_SUBJECT
                        else "https-domain"
                    ),
                    "HTTPS_DOMAIN": subject,
                    "UPDATED_AT": now_iso(),
                },
            )
            config = {
                "enabled": True,
                "domain": subject,
                "subjectType": subject_type,
                "email": email,
                "challengeType": challenge_type,
                "certificateProfile": (
                    SHORTLIVED_PROFILE
                    if subject_type == IP_SUBJECT
                    else None
                ),
                "autoRenewEnabled": True,
                "enabledAt": now_iso(),
                "lastRenewedAt": now_iso(),
                "lastRenewalCheckAt": now_iso(),
            }
            save_config(config)
            LAST_ERROR_FILE.unlink(missing_ok=True)
            schedule_runtime_apply()
            return https_status()
        except Exception as caught:
            atomic_write(NGINX_SITE, original_nginx, mode=0o644)
            atomic_write(ENV_FILE, original_env)
            restore_file(certificate, original_certificate)
            restore_file(key, original_key)
            if original_install_conf is None:
                INSTALL_CONF.unlink(missing_ok=True)
            else:
                atomic_write(INSTALL_CONF, original_install_conf)
            try:
                run([require_command("nginx"), "-t"], timeout=30)
                run([require_command("systemctl"), "reload", "nginx"], timeout=30)
            except Exception:
                pass
            atomic_write(LAST_ERROR_FILE, f"{now_iso()} {caught}\n")
            if isinstance(caught, HttpsError):
                raise
            raise HttpsError(str(caught)) from caught


def renew_https(*, scheduled: bool = False) -> dict[str, Any]:
    with operation_lock():
        config = read_json(CONFIG_FILE)
        if not config.get("enabled"):
            return https_status()
        if scheduled and not config.get("autoRenewEnabled", True):
            return https_status()
        subject, detected_subject_type = normalize_subject(
            str(config.get("domain", ""))
        )
        subject_type = str(
            config.get("subjectType", detected_subject_type)
        )
        if subject_type not in (DOMAIN_SUBJECT, IP_SUBJECT):
            subject_type = detected_subject_type
        email = normalize_email(str(config.get("email", "")))
        challenge_type = str(config.get("challengeType", HTTP_CHALLENGE))
        if challenge_type not in (HTTP_CHALLENGE, TLS_ALPN_CHALLENGE):
            raise HttpsError("HTTPS 配置中的 ACME 验证方式无效")
        certificate, key = certificate_paths(subject)
        before = certificate.stat().st_mtime_ns if certificate.exists() else 0
        original_nginx = NGINX_SITE.read_text(encoding="utf-8")
        original_certificate = snapshot_file(certificate)
        original_key = snapshot_file(key)
        try:
            if challenge_type == TLS_ALPN_CHALLENGE:
                install_nginx_config(http_nginx_config(subject))
                wait_for_tls_challenge_port()
            run(
                lego_arguments(
                    subject,
                    email,
                    "renew",
                    challenge_type,
                    subject_type,
                ),
                timeout=240,
            )
            after = certificate.stat().st_mtime_ns if certificate.exists() else 0
            config["lastRenewalCheckAt"] = now_iso()
            if challenge_type == TLS_ALPN_CHALLENGE:
                install_nginx_config(
                    https_nginx_config(subject, certificate, key)
                )
            elif after != before:
                run([require_command("nginx"), "-t"], timeout=30)
                run([require_command("systemctl"), "reload", "nginx"], timeout=30)
            if after != before:
                config["lastRenewedAt"] = now_iso()
            save_config(config)
            LAST_ERROR_FILE.unlink(missing_ok=True)
        except Exception as caught:
            restore_file(certificate, original_certificate)
            restore_file(key, original_key)
            atomic_write(NGINX_SITE, original_nginx, mode=0o644)
            try:
                run([require_command("nginx"), "-t"], timeout=30)
                run([require_command("systemctl"), "reload", "nginx"], timeout=30)
            except Exception:
                pass
            atomic_write(LAST_ERROR_FILE, f"{now_iso()} 自动续期失败：{caught}\n")
            raise
        return https_status()


def disable_https(http_host_value: str) -> dict[str, Any]:
    http_host, _ = normalize_subject(http_host_value)
    with operation_lock():
        config = read_json(CONFIG_FILE)
        original_nginx = NGINX_SITE.read_text(encoding="utf-8")
        original_env = ENV_FILE.read_text(encoding="utf-8")
        original_install_conf = (
            INSTALL_CONF.read_text(encoding="utf-8")
            if INSTALL_CONF.is_file()
            else None
        )
        try:
            install_nginx_config(http_nginx_config(http_host))
            update_env_values(
                {
                    "SESSION_COOKIE_SECURE": "false",
                    "WEB_ORIGIN": f"http://{http_host}",
                }
            )
            update_key_value_file(
                INSTALL_CONF,
                {
                    "ACCESS_MODE": "http-ip",
                    "HTTPS_DOMAIN": "",
                    "UPDATED_AT": now_iso(),
                },
            )
            config.update(
                {
                    "enabled": False,
                    "domain": None,
                    "subjectType": None,
                    "challengeType": None,
                    "certificateProfile": None,
                    "autoRenewEnabled": False,
                    "disabledAt": now_iso(),
                    "httpHost": http_host,
                }
            )
            save_config(config)
            LAST_ERROR_FILE.unlink(missing_ok=True)
            schedule_runtime_apply()
            return https_status()
        except Exception as caught:
            atomic_write(NGINX_SITE, original_nginx, mode=0o644)
            atomic_write(ENV_FILE, original_env)
            if original_install_conf is None:
                INSTALL_CONF.unlink(missing_ok=True)
            else:
                atomic_write(INSTALL_CONF, original_install_conf)
            try:
                run([require_command("nginx"), "-t"], timeout=30)
                run(
                    [require_command("systemctl"), "reload", "nginx"],
                    timeout=30,
                )
            except Exception:
                pass
            if isinstance(caught, HttpsError):
                raise
            raise HttpsError(str(caught)) from caught


def set_auto_renew(enabled: bool) -> dict[str, Any]:
    with operation_lock():
        config = read_json(CONFIG_FILE)
        if not config.get("enabled"):
            raise HttpsError("HTTPS 尚未启用，无法配置自动续期")
        previous = config.get("autoRenewEnabled", True)
        config["autoRenewEnabled"] = enabled
        try:
            save_config(config)
        except Exception:
            config["autoRenewEnabled"] = previous
            save_config(config)
            raise
        return https_status()


def https_status() -> dict[str, Any]:
    config = read_json(CONFIG_FILE)
    domain = str(config.get("domain", ""))
    certificate = certificate_paths(domain)[0] if domain else None
    detected_subject_type = None
    if domain:
        try:
            _, detected_subject_type = normalize_subject(domain)
        except HttpsError:
            pass
    subject_type = config.get("subjectType") or detected_subject_type
    last_error = ""
    try:
        last_error = LAST_ERROR_FILE.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        pass
    return {
        "available": LEGO_BIN.is_file() and os.access(LEGO_BIN, os.X_OK),
        "enabled": bool(config.get("enabled")),
        "domain": domain or None,
        "subjectType": subject_type,
        "challengeType": config.get("challengeType"),
        "certificateProfile": (
            config.get("certificateProfile")
            or (SHORTLIVED_PROFILE if subject_type == IP_SUBJECT else None)
        ),
        "autoRenewEnabled": bool(
            config.get("autoRenewEnabled", bool(config.get("enabled")))
        ),
        "httpHost": config.get("httpHost"),
        "expiresAt": certificate_expiry(certificate) if certificate else None,
        "lastRenewedAt": config.get("lastRenewedAt"),
        "lastRenewalCheckAt": config.get("lastRenewalCheckAt"),
        "lastError": last_error or None,
    }


def handle_request(request: dict[str, Any]) -> dict[str, Any]:
    action = request.get("action")
    if action == "status":
        return {"ok": True, "status": https_status()}
    if action == "enable":
        return {
            "ok": True,
            "status": enable_https(
                str(request.get("domain", "")),
                str(request.get("email", "")),
            ),
        }
    if action == "renew":
        return {"ok": True, "status": renew_https()}
    if action == "disable":
        return {
            "ok": True,
            "status": disable_https(str(request.get("httpHost", ""))),
        }
    if action == "set-auto-renew":
        enabled = request.get("enabled")
        if not isinstance(enabled, bool):
            raise HttpsError("自动续期开关值无效")
        return {"ok": True, "status": set_auto_renew(enabled)}
    raise HttpsError("不支持的 HTTPS 助手操作")


def serve() -> None:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    SOCKET_PATH.unlink(missing_ok=True)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(SOCKET_PATH))
    os.chmod(SOCKET_PATH, 0o660)
    try:
        os.chown(SOCKET_PATH, 0, API_SOCKET_GID)
    except PermissionError:
        if STATE_DIR == Path("/opt/liveboard"):
            raise
    server.listen(8)
    try:
        while True:
            connection, _ = server.accept()
            with connection:
                try:
                    payload = b""
                    while b"\n" not in payload and len(payload) <= 16_384:
                        chunk = connection.recv(4096)
                        if not chunk:
                            break
                        payload += chunk
                    if len(payload) > 16_384:
                        raise HttpsError("HTTPS 助手请求过大")
                    request = json.loads(payload.split(b"\n", 1)[0].decode("utf-8"))
                    if not isinstance(request, dict):
                        raise HttpsError("HTTPS 助手请求格式无效")
                    response = handle_request(request)
                except Exception as caught:
                    response = {
                        "ok": False,
                        "message": str(caught)[-1200:] or "HTTPS 助手执行失败",
                    }
                connection.sendall(
                    (json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8")
                )
    finally:
        server.close()
        SOCKET_PATH.unlink(missing_ok=True)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command")
    enable = subparsers.add_parser("enable")
    enable.add_argument("--domain", required=True)
    enable.add_argument("--email", required=True)
    subparsers.add_parser("status")
    renew = subparsers.add_parser("renew")
    renew.add_argument("--scheduled", action="store_true")
    disable = subparsers.add_parser("disable")
    disable.add_argument("--http-host", required=True)
    auto_renew = subparsers.add_parser("set-auto-renew")
    auto_renew.add_argument(
        "state",
        choices=("on", "off"),
    )
    subparsers.add_parser("apply-runtime")
    subparsers.add_parser("serve")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    try:
        if arguments.command in (None, "serve"):
            serve()
            return 0
        if arguments.command == "enable":
            result = enable_https(arguments.domain, arguments.email)
        elif arguments.command == "renew":
            result = renew_https(scheduled=arguments.scheduled)
        elif arguments.command == "disable":
            result = disable_https(arguments.http_host)
        elif arguments.command == "set-auto-renew":
            result = set_auto_renew(arguments.state == "on")
        elif arguments.command == "apply-runtime":
            apply_runtime()
            return 0
        else:
            result = https_status()
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as caught:
        print(str(caught), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
