#!/usr/bin/env python3
"""刷题本：本地刷题小工具。

    python3 app.py            启动（首次会自动下载并生成题库）
    python3 app.py --update   从 GitHub 拉取最新内容后再启动
"""
import argparse
import json
import shutil
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import build

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
DATA = ROOT / "data"
BANK = DATA / "bank.json"
PROGRESS = DATA / "progress.json"
BACKUPS = DATA / "backups"
KEEP_BACKUPS = 14
MAX_BODY = 20 * 1024 * 1024

save_lock = threading.Lock()


def backup_progress():
    """每天第一次保存前，把旧进度复制一份，保留最近 14 天。"""
    if not PROGRESS.exists():
        return
    BACKUPS.mkdir(exist_ok=True)
    target = BACKUPS / ("progress-%s.json" % time.strftime("%Y-%m-%d"))
    if not target.exists():
        shutil.copyfile(PROGRESS, target)
    for old in sorted(BACKUPS.glob("progress-*.json"))[:-KEEP_BACKUPS]:
        old.unlink()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def local_only(self):
        # 只接受本机访问，防止其他网页借 DNS 重绑定读写进度
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            self.send_error(403)
            return False
        return True

    def send_json_bytes(self, body, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.local_only():
            return
        path = self.path.split("?", 1)[0]
        if path == "/api/bank":
            return self.send_json_bytes(BANK.read_bytes())
        if path == "/api/progress":
            body = PROGRESS.read_bytes() if PROGRESS.exists() else b"{}"
            return self.send_json_bytes(body)
        return super().do_GET()

    def do_PUT(self):
        if not self.local_only():
            return
        if self.path.split("?", 1)[0] != "/api/progress":
            return self.send_error(404)
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.send_error(413)
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("items"), dict):
                raise ValueError
        except ValueError:
            return self.send_error(400, "invalid progress data")  # 状态行只能用 ASCII
        with save_lock:
            backup_progress()
            tmp = PROGRESS.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            tmp.replace(PROGRESS)
        self.send_json_bytes(b'{"ok":true}')


def main():
    ap = argparse.ArgumentParser(description="刷题本：JavaGuide / 代码随想录 / AgentGuide 本地刷题")
    ap.add_argument("--port", type=int, default=8765, help="端口，默认 8765")
    ap.add_argument("--update", action="store_true", help="先从 GitHub 拉取最新内容并重建题库")
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = ap.parse_args()

    if args.update or not BANK.exists() or not (WEB / "vendor" / "marked.min.js").exists():
        try:
            build.build(update=args.update)
        except Exception as exc:
            print("\n生成题库失败：%s" % exc)
            print("请检查网络能否访问 github.com，然后重试。")
            if not BANK.exists():
                sys.exit(1)
            print("先用上次生成的题库启动。")

    server = None
    for port in range(args.port, args.port + 20):  # 端口被占用就自动往后找
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if server is None:
        print("端口 %d~%d 都被占用了，可以指定一个：python3 app.py --port 9000" % (args.port, args.port + 19))
        sys.exit(1)
    url = "http://127.0.0.1:%d/" % server.server_address[1]
    print("刷题本已启动：%s   （按 Ctrl+C 退出）" % url, flush=True)
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出，进度保存在 data/progress.json")


if __name__ == "__main__":
    main()
