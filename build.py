#!/usr/bin/env python3
"""从 JavaGuide、代码随想录、AgentGuide 拉取内容，解析成题库 data/bank.json。

内容只下载到本机供个人学习，版权归原作者。
"""
import hashlib
import json
import posixpath
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
DATA = ROOT / "data"
VENDOR = ROOT / "web" / "vendor"

SOURCES = {
    "javaguide": {
        "name": "JavaGuide",
        "repo": "Snailclimb/JavaGuide",
        "patterns": ["/docs/**/*.md"],
    },
    "carl": {
        "name": "代码随想录",
        "repo": "youngyangyang04/leetcode-master",
        "patterns": ["/README.md", "/problems/*.md", "/problems/kamacoder/*.md"],
    },
    "agentguide": {
        "name": "AgentGuide",
        "repo": "adongwanai/AgentGuide",
        "patterns": [
            "/docs/04-interview/*.md",
            "/docs/04-interview/18-agent-interview-playbooks/*.md",
        ],
    },
}

AG = "docs/04-interview/"
PB = AG + "18-agent-interview-playbooks/"
JG = "docs/"

# 题库分组：(来源, 路径或通配符)。顺序即刷题顺序。
BANKS = [
    {
        "id": "ai",
        "name": "AI 应用开发",
        "groups": [
            {"id": "ai-llm", "name": "大模型基础", "files": [
                ("agentguide", AG + "16-llm-fundamentals.md"),
                ("javaguide", JG + "ai/llm-basis/*.md"),
                ("agentguide", AG + "01-theory-questions.md"),
                ("agentguide", AG + "13-model-evaluation.md"),
            ]},
            # 有答案的讲解放前面，AgentGuide 只有题目的真题清单放最后
            {"id": "ai-rag", "name": "RAG", "files": [
                ("javaguide", JG + "ai/rag/rag-basis.md"),
                ("javaguide", JG + "ai/rag/*.md"),
                ("agentguide", PB + "agentic-rag-deep-research-playbook.md"),
                ("agentguide", AG + "02-rag-questions.md"),
            ]},
            {"id": "ai-agent", "name": "Agent", "files": [
                ("javaguide", JG + "ai/agent/agent-basis.md"),
                ("javaguide", JG + "ai/agent/*.md"),
                ("agentguide", PB + "agent-harness-playbook.md"),
                ("agentguide", PB + "agent-memory-playbook.md"),
                ("agentguide", PB + "agent-skills-procedural-memory-playbook.md"),
                ("agentguide", PB + "agent-evaluation-playbook.md"),
                ("agentguide", PB + "data-synthesis-playbook.md"),
                ("agentguide", PB + "claude-code-source-playbook.md"),
                ("agentguide", PB + "openclaw-source-playbook.md"),
                ("agentguide", PB + "hermes-self-evolution-playbook.md"),
                ("agentguide", AG + "03-agent-questions.md"),
            ]},
            {"id": "ai-sys", "name": "AI 系统设计与项目", "files": [
                ("javaguide", JG + "ai/system-design/ai-application-architecture.md"),
                ("javaguide", JG + "ai/system-design/*.md"),
                ("javaguide", JG + "ai/interview-questions/agent-project-interview-guide.md"),
                ("agentguide", AG + "06-development-specialized.md"),
            ]},
            {"id": "ai-code", "name": "AI 手撕代码", "files": [
                ("agentguide", AG + "04-coding-questions.md"),
            ]},
            {"id": "ai-algo", "name": "算法岗专项", "files": [
                ("agentguide", AG + "05-algorithm-specialized.md"),
            ]},
            {"id": "ai-open", "name": "开放题与趋势", "files": [
                ("agentguide", AG + "14-llm-future-trends.md"),
                ("agentguide", AG + "15-open-discussion.md"),
            ]},
        ],
    },
    {
        "id": "be",
        "name": "后端基础",
        "groups": [
            {"id": "be-net", "name": "计算机网络", "files": [
                ("javaguide", JG + "cs-basics/network/other-network-questions.md"),
                ("javaguide", JG + "cs-basics/network/other-network-questions2.md"),
            ]},
            {"id": "be-os", "name": "操作系统", "files": [
                ("javaguide", JG + "cs-basics/operating-system/operating-system-basic-questions-01.md"),
                ("javaguide", JG + "cs-basics/operating-system/operating-system-basic-questions-02.md"),
            ]},
            {"id": "be-mysql", "name": "MySQL", "files": [
                ("javaguide", JG + "database/mysql/mysql-questions-01.md"),
                ("javaguide", JG + "database/mysql/mysql-index.md"),
                ("javaguide", JG + "database/mysql/transaction-isolation-level.md"),
                ("javaguide", JG + "database/mysql/innodb-implementation-of-mvcc.md"),
                ("javaguide", JG + "database/mysql/mysql-logs.md"),
                ("javaguide", JG + "database/mysql/how-sql-executed-in-mysql.md"),
                ("javaguide", JG + "database/mysql/mysql-query-execution-plan.md"),
            ]},
            {"id": "be-redis", "name": "Redis 与缓存", "files": [
                ("javaguide", JG + "database/redis/redis-questions-01.md"),
                ("javaguide", JG + "database/redis/redis-questions-02.md"),
                ("javaguide", JG + "database/redis/cache-basics.md"),
                ("javaguide", JG + "database/redis/3-commonly-used-cache-read-and-write-strategies.md"),
                ("javaguide", JG + "database/redis/redis-persistence.md"),
                ("javaguide", JG + "database/redis/redis-data-structures-01.md"),
                ("javaguide", JG + "database/redis/redis-skiplist.md"),
            ]},
            {"id": "be-mq", "name": "消息队列", "files": [
                ("javaguide", JG + "high-performance/message-queue/message-queue.md"),
                ("javaguide", JG + "high-performance/message-queue/kafka-questions-01.md"),
                ("javaguide", JG + "high-performance/message-queue/rocketmq-questions.md"),
                ("javaguide", JG + "high-performance/message-queue/rabbitmq-questions.md"),
            ]},
            {"id": "be-dist", "name": "分布式", "files": [
                ("javaguide", JG + "distributed-system/protocol/cap-and-base-theorem.md"),
                ("javaguide", JG + "distributed-system/protocol/raft-algorithm.md"),
                ("javaguide", JG + "distributed-system/protocol/consistent-hashing.md"),
                ("javaguide", JG + "distributed-system/distributed-lock.md"),
                ("javaguide", JG + "distributed-system/distributed-lock-implementations.md"),
                ("javaguide", JG + "distributed-system/distributed-id.md"),
                ("javaguide", JG + "distributed-system/distributed-transaction.md"),
                ("javaguide", JG + "distributed-system/rpc/rpc-intro.md"),
                ("javaguide", JG + "distributed-system/api-gateway.md"),
            ]},
            {"id": "be-ha", "name": "高可用与高性能", "files": [
                ("javaguide", JG + "high-availability/high-availability-system-design.md"),
                ("javaguide", JG + "high-availability/limit-request.md"),
                ("javaguide", JG + "high-availability/fallback-and-circuit-breaker.md"),
                ("javaguide", JG + "high-availability/timeout-and-retry.md"),
                ("javaguide", JG + "high-availability/idempotency.md"),
                ("javaguide", JG + "high-availability/redundancy.md"),
                ("javaguide", JG + "high-performance/load-balancing.md"),
                ("javaguide", JG + "high-performance/read-and-write-separation-and-library-subtable.md"),
                ("javaguide", JG + "high-performance/deep-pagination-optimization.md"),
                ("javaguide", JG + "high-performance/cdn.md"),
            ]},
            {"id": "be-auth", "name": "认证授权", "files": [
                ("javaguide", JG + "system-design/security/basis-of-authority-certification.md"),
                ("javaguide", JG + "system-design/security/jwt-intro.md"),
                ("javaguide", JG + "system-design/security/advantages-and-disadvantages-of-jwt.md"),
                ("javaguide", JG + "system-design/security/sso-intro.md"),
            ]},
            {"id": "be-java", "name": "Java 基础", "files": [
                ("javaguide", JG + "java/basis/java-basic-questions-01.md"),
                ("javaguide", JG + "java/basis/java-basic-questions-02.md"),
                ("javaguide", JG + "java/basis/java-basic-questions-03.md"),
            ]},
            {"id": "be-coll", "name": "Java 集合", "files": [
                ("javaguide", JG + "java/collection/java-collection-questions-01.md"),
                ("javaguide", JG + "java/collection/java-collection-questions-02.md"),
            ]},
            {"id": "be-conc", "name": "Java 并发", "files": [
                ("javaguide", JG + "java/concurrent/java-concurrent-questions-01.md"),
                ("javaguide", JG + "java/concurrent/java-concurrent-questions-02.md"),
                ("javaguide", JG + "java/concurrent/java-concurrent-questions-03.md"),
            ]},
            {"id": "be-jvm", "name": "JVM", "files": [
                ("javaguide", JG + "java/jvm/memory-area.md"),
                ("javaguide", JG + "java/jvm/jvm-garbage-collection.md"),
                ("javaguide", JG + "java/jvm/class-loading-process.md"),
                ("javaguide", JG + "java/jvm/classloader.md"),
            ]},
            {"id": "be-spring", "name": "Spring 与 MyBatis", "files": [
                ("javaguide", JG + "system-design/framework/spring/spring-knowledge-and-questions-summary.md"),
                ("javaguide", JG + "system-design/framework/mybatis/mybatis-interview.md"),
            ]},
        ],
    },
    # 力扣分组从代码随想录 README 自动生成
    {"id": "lc", "name": "力扣 · 代码随想录", "groups": []},
]

CARL_SKIP_GROUPS = {"前序"}
MIN_FILE_BYTES = 3000  # 小于这个体积的多半是占位或付费引导页

JUNK_HEADINGS = {
    "参考", "参考资料", "参考文献", "参考链接", "推荐阅读", "总结", "小结", "写在最后", "后记",
    "相关阅读", "拓展阅读", "延伸阅读", "前言", "引言", "概述", "结语", "相关文章", "文章推荐",
    "介绍", "目录", "适用对象", "使用指南", "备考建议", "答题技巧", "学习路径", "参考资源",
}

LANG_KEYS = [
    ("javascript", "JavaScript"), ("typescript", "TypeScript"), ("python", "Python"),
    ("golang", "Go"), ("java", "Java"), ("c++", "C++"), ("cpp", "C++"), ("c#", "C#"),
    ("csharp", "C#"), ("rust", "Rust"), ("swift", "Swift"), ("kotlin", "Kotlin"),
    ("scala", "Scala"), ("php", "PHP"), ("ruby", "Ruby"), ("dart", "Dart"),
    ("go", "Go"), ("js", "JavaScript"), ("ts", "TypeScript"), ("c", "C"),
]

VENDOR_FILES = {
    "marked.min.js": "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
    "purify.min.js": "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js",
    "highlight.min.js": "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
}


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- git


def git(*args, cwd=None):
    r = subprocess.run(["git"] + list(args), cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("git %s 失败：%s" % (" ".join(args), r.stderr.strip()))
    return r.stdout.strip()


def sync_source(key, update):
    src = SOURCES[key]
    d = CACHE / key
    url = "https://github.com/%s.git" % src["repo"]
    if not (d / ".git").exists():
        log("  下载 %s（%s）…" % (src["name"], src["repo"]))
        if d.exists():
            shutil.rmtree(d)
        try:
            git("clone", "--depth", "1", "--filter=blob:none", "--sparse", url, str(d))
            git("sparse-checkout", "set", "--no-cone", *src["patterns"], cwd=d)
        except Exception:
            shutil.rmtree(d, ignore_errors=True)
            raise
    elif update:
        log("  更新 %s …" % src["name"])
        git("sparse-checkout", "set", "--no-cone", *src["patterns"], cwd=d)
        branch = git("rev-parse", "--abbrev-ref", "HEAD", cwd=d)
        git("fetch", "--depth", "1", "origin", branch, cwd=d)
        git("reset", "--hard", "FETCH_HEAD", cwd=d)
    src["branch"] = git("rev-parse", "--abbrev-ref", "HEAD", cwd=d)
    src["commit"] = git("rev-parse", "--short", "HEAD", cwd=d)
    src["date"] = git("log", "-1", "--format=%cs", cwd=d)
    src["dir"] = d


def fetch_vendor(force=False):
    VENDOR.mkdir(parents=True, exist_ok=True)
    for name, url in VENDOR_FILES.items():
        target = VENDOR / name
        if target.exists() and target.stat().st_size > 1000 and not force:
            continue
        log("  下载前端依赖 %s …" % name)
        with urllib.request.urlopen(url, timeout=60) as r:
            target.write_bytes(r.read())


# ---------------------------------------------------------------- markdown helpers

FRONT_RE = re.compile(r"\A﻿?---\n(.*?)\n---\n", re.S)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
HEAD_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
STAR_RE = re.compile("⭐️?|\U0001f31f")
LEAD_JUNK_RE = re.compile(
    "^[\\s☀-➿\U0001f300-\U0001faff️‍]+"
)
LINK_RE = re.compile(r"(!?\[[^\]\n]*\]\()([^)\s]+)((?:\s+\"[^\"\n]*\")?\))")


def read(path):
    return path.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")


def front_title(text):
    m = FRONT_RE.match(text)
    if m:
        t = re.search(r"^title:\s*(.+)$", m.group(1), re.M)
        if t:
            return t.group(1).strip().strip("\"'")
    return None


def strip_front(text):
    text = FRONT_RE.sub("", text, count=1)
    return COMMENT_RE.sub("", text)


def scan_headings(lines):
    """返回代码块之外的标题 [(行号, 级别, 文本)]。"""
    out = []
    fence = None
    for i, line in enumerate(lines):
        m = FENCE_RE.match(line)
        if m:
            tok = m.group(1)[0]
            if fence is None:
                fence = tok
            elif tok == fence and line.strip().strip(tok) == "":
                fence = None
            continue
        if fence:
            continue
        h = HEAD_RE.match(line)
        if h:
            out.append((i, len(h.group(1)), h.group(2).strip()))
    return out


def fence_mask(lines):
    """每行是否位于代码块内（含围栏行本身）。"""
    mask = []
    fence = None
    for line in lines:
        m = FENCE_RE.match(line)
        if m:
            tok = m.group(1)[0]
            mask.append(True)
            if fence is None:
                fence = tok
            elif tok == fence and line.strip().strip(tok) == "":
                fence = None
            continue
        mask.append(fence is not None)
    return mask


def clean_title(t):
    important = bool(STAR_RE.search(t))
    t = STAR_RE.sub("", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("**", "").replace("`", "")
    t = LEAD_JUNK_RE.sub("", t)
    return t.strip(), important


JUNK_RE = re.compile(r"延伸阅读|学习资料|资料推荐|推荐阅读|^参考|^更新记录|^术语说明$|^论文$|官方文档与|^其他$|^附录|^相关")


def is_junk(title):
    t = re.sub(r"^[\d一二三四五六七八九十]+[、.．\s]+", "", title).strip()
    return t in JUNK_HEADINGS or bool(JUNK_RE.search(t))


def visible_len(md):
    return len(re.sub(r"\s+", "", md))


def convert_containers(md):
    """VuePress 的 ::: tip 容器转成普通 HTML 块，方便 marked 渲染。"""
    names = {"tip": "提示", "warning": "注意", "danger": "警告", "info": "说明", "note": "说明", "details": "详情"}
    lines = md.split("\n")
    mask = fence_mask(lines)
    out = []
    depth = 0
    for line, in_code in zip(lines, mask):
        m = None if in_code else re.match(r"^\s*:::+\s*([\w-]+)?\s*(.*)$", line)
        if m:
            kind, title = m.group(1), m.group(2).strip()
            if kind:
                depth += 1
                label = title or names.get(kind.lower(), "")
                out += ["", '<div class="callout">', ""]
                if label:
                    out += ["**%s**" % label, ""]
            elif depth:
                depth -= 1
                out += ["", "</div>", ""]
            continue
        out.append(line)
    out += ["", "</div>"] * depth
    return "\n".join(out)


def rewrite_links(md, src_key, rel_path):
    src = SOURCES[src_key]
    repo, branch = src["repo"], src["branch"]
    base = posixpath.dirname(rel_path)

    def fix(m):
        url = m.group(2)
        if re.match(r"^([a-z][a-z0-9+.-]*:|#|//)", url, re.I):
            return m.group(0)
        is_img = m.group(1).startswith("!")
        path, _, frag = url.partition("#")
        path = urllib.parse.unquote(path)
        if src_key == "javaguide" and path.startswith("/"):
            full = "docs" + path
        else:
            full = posixpath.normpath(posixpath.join(base, path))
        if is_img:
            new = "https://raw.githubusercontent.com/%s/%s/%s" % (repo, branch, full)
        elif src_key == "javaguide" and full.startswith("docs/") and full.endswith(".md"):
            new = "https://javaguide.cn/%s.html" % full[5:-3]
        else:
            new = "https://github.com/%s/blob/%s/%s" % (repo, branch, full)
        if frag and not is_img:
            new += "#" + frag
        return m.group(1) + new + m.group(3)

    return LINK_RE.sub(fix, md)


def tidy(md):
    """去掉多余空行，以及首尾只是分隔线的行。"""
    lines = md.strip().split("\n")
    while lines and re.fullmatch(r"\s*(-{3,}|\*{3,}|_{3,})?\s*", lines[-1]):
        lines.pop()
    while lines and re.fullmatch(r"\s*(-{3,}|\*{3,}|_{3,})?\s*", lines[0]):
        lines.pop(0)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def source_url(src_key, rel_path):
    src = SOURCES[src_key]
    if src_key == "javaguide" and rel_path.startswith("docs/"):
        return "https://javaguide.cn/%s.html" % rel_path[5:-3]
    return "https://github.com/%s/blob/%s/%s" % (src["repo"], src["branch"], rel_path)


# ---------------------------------------------------------------- parsers


def is_question(title):
    return bool(re.search(r"[？?]\s*$", title))


def parse_heading_doc(text, rel):
    """JavaGuide。

    “面试题总结”类文档：## 是分类，### 是题目。
    普通文章：作者把 ### 写成问句时按 ### 拆；否则整个 ## 小节算一道题，避免切得太碎。
    """
    doc_title = front_title(text) or ""
    lines = strip_front(text).split("\n")
    heads = [h for h in scan_headings(lines) if h[1] >= 2]
    qa_doc = bool(re.search(r"question|interview", posixpath.basename(rel)))
    items = []

    def add(title, star, cat, body, line, min_len=40):
        if not is_junk(title) and visible_len(body) >= min_len:
            items.append({"title": title, "cat": cat, "md": body, "star": star, "line": line})

    h2s = [(k, h) for k, h in enumerate(heads) if h[1] == 2]
    if not h2s:  # 只有 ### 的文章，把 ### 当 ##
        heads = [(i, 2 if l == 3 else l, t) for (i, l, t) in heads]
        h2s = [(k, h) for k, h in enumerate(heads) if h[1] == 2]
    for k, (i, _, raw) in h2s:
        title, star = clean_title(raw)
        end = next((j for (j, l2, _) in heads[k + 1:] if l2 <= 2), len(lines))
        kids = [(j, t) for (j, l2, t) in heads[k + 1:] if l2 == 3 and j < end]
        kid_q = sum(1 for _, t in kids if is_question(clean_title(t)[0]))
        split = kids and (qa_doc or kid_q * 2 >= len(kids))
        if not split:
            add(title, star, doc_title, "\n".join(lines[i + 1:end]), i + 1, 60)
            continue
        if is_junk(title):
            continue
        if is_question(title):  # 问句形式的分类，导语单独算一道题
            add(title, star, doc_title, "\n".join(lines[i + 1:kids[0][0]]), i + 1, 120)
        for n, (j, raw3) in enumerate(kids):
            t3, s3 = clean_title(raw3)
            e3 = kids[n + 1][0] if n + 1 < len(kids) else end
            add(t3, s3 or star, title, "\n".join(lines[j + 1:e3]), j + 1)
    return doc_title, items


QBOLD_RE = re.compile(r"^\*\*Q(\d+)\s*[:：.、]\s*(.+?)\*\*\s*$")
QHEAD_RE = re.compile(r"^(#{2,5})\s*Q(\d+)\s*[:：.、]\s*(.+?)\s*$")
META_RE = re.compile(r"^\s*[-*]?\s*\**(难度|岗位|标签|公司|时间|语言|来源)\**\s*[:：]\s*(.+?)\s*$")
STATEMENT_HINT_RE = re.compile(
    r"(\*\*|^\s*[-*]\s*\**)(需求分析|需求|要求|场景|考察点|问题|目标|背景|约束)\**\s*[:：]?", re.M
)
ANSWER_HINT_RE = re.compile(r"回答|答案|考点|要点|思路|解析|推荐|模板|示例代码|```")


def parse_q_doc(text):
    """AgentGuide：**Q1: …** 或 ## Q1. … 形式的题库。"""
    doc_title = front_title(text) or ""
    lines = strip_front(text).split("\n")
    mask = fence_mask(lines)
    marks = []  # (行号, 类型, 级别, 标题)
    heads = []
    for i, line in enumerate(lines):
        if mask[i]:
            continue
        h = HEAD_RE.match(line)
        if h:
            qh = QHEAD_RE.match(line)
            if qh:
                marks.append((i, "head", len(qh.group(1)), qh.group(3)))
            else:
                heads.append((i, len(h.group(1)), h.group(2).strip()))
                if len(h.group(1)) == 1 and not doc_title:
                    doc_title = clean_title(h.group(2))[0]
            continue
        qb = QBOLD_RE.match(line)
        if qb:
            marks.append((i, "bold", 9, qb.group(2)))
    doc_title = clean_title(doc_title)[0]
    items = []
    for n, (i, kind, lvl, raw) in enumerate(marks):
        limit = lvl if kind == "head" else 3
        nxt_mark = marks[n + 1][0] if n + 1 < len(marks) else len(lines)
        nxt_head = next((j for (j, l2, _) in heads if j > i and l2 <= limit), len(lines))
        end = min(nxt_mark, nxt_head)
        parent = [t for (j, l2, t) in heads if j < i and l2 < min(lvl, 4)]
        cat = clean_title(parent[-1])[0] if parent else doc_title
        if kind == "head" and lvl == 2:
            cat = doc_title  # 备战手册里一级标题只是“三、高频题”之类，直接用手册名
        meta = {}
        body = []
        for k, line in enumerate(lines[i + 1:end]):
            m = META_RE.match(line) if k < 14 else None
            if m:
                meta[m.group(1)] = m.group(2).strip()
                continue
            body.append(line)
        md = tidy("\n".join(body))
        title, star = clean_title(raw)
        item = {"title": title, "cat": cat, "md": md, "star": star, "line": i + 1, "meta": meta}
        if md and STATEMENT_HINT_RE.search(md) and not ANSWER_HINT_RE.search(md):
            item["statement"], item["md"] = md, ""
        items.append(item)
    return doc_title, items


def norm_lang(heading):
    t = re.sub(r"[*:：\s]", "", heading).lower()
    t = re.sub(r"[（(].*$", "", t)
    for key, name in LANG_KEYS:
        if t.startswith(key):
            rest = t[len(key):]
            # 防止 "c" 误匹配 "cangjie"、"go" 误匹配 "google"
            if key in ("c", "go", "js", "ts") and rest and rest[0].isalpha() and not rest.startswith(("版", "语言")):
                continue
            return name
    return None


OJ = r"https?://(?:leetcode\.cn|leetcode\.com|leetcode-cn\.com|kamacoder\.com)/[^)\s]+"
LC_LINK_RE = re.compile(r"\[[^\]]*\]\(\s*(" + OJ + r")\s*\)")
LC_BARE_RE = re.compile(r"(?:链接|地址)\s*[:：]\s*(" + OJ + ")")


def parse_problem(text, rel):
    lines = strip_front(text).split("\n")
    heads = scan_headings(lines)
    h1 = next(((i, t) for (i, l, t) in heads if l == 1), None)
    if not h1:
        return None
    start = h1[0]
    body = lines[start + 1:]
    hs = [(i - start - 1, l, t) for (i, l, t) in heads if i > start]
    first_h2 = next((i for (i, l, t) in hs if l == 2), len(body))
    link = None
    for k, line in enumerate(body[:max(first_h2, 25)]):
        m = LC_LINK_RE.search(line) or LC_BARE_RE.search(line)
        if m:
            link = m.group(1)
            if "题目链接" in line or "题目地址" in line or LC_BARE_RE.search(line):
                body[k] = ""  # 这一行只是链接，界面上单独放“去做题”按钮
            break
    # 理论基础、总结篇不算题；“递归遍历”这类专题讲解即使开头没有题目链接也保留
    if re.search(r"理论基础|总结|周末", posixpath.basename(rel) + h1[1]):
        return None
    statement = "\n".join(body[:first_h2])
    other = next(((i, l) for (i, l, t) in hs if "其他语言" in t), None)
    main_end = other[0] if other else len(body)
    solution = "\n".join(body[first_h2:main_end])
    langs = {}
    if other:
        oi, ol = other
        stop = next((i for (i, l, t) in hs if i > oi and l <= ol), len(body))
        subs = [(i, l, t) for (i, l, t) in hs if oi < i < stop and l == ol + 1]
        for n, (i, l, t) in enumerate(subs):
            end = subs[n + 1][0] if n + 1 < len(subs) else stop
            name = norm_lang(t)
            if not name:
                continue
            chunk = "\n".join(body[i + 1:end]).strip()
            langs[name] = (langs.get(name, "") + "\n\n" + chunk).strip()
    title = clean_title(h1[1])[0]
    return {"title": title, "link": link, "statement": statement, "md": solution, "langs": langs}


# ---------------------------------------------------------------- build


def expand(src_key, pattern):
    root = SOURCES[src_key]["dir"]
    if any(ch in pattern for ch in "*?["):
        files = sorted(p for p in root.glob(pattern) if p.name not in ("README.md", "TODO.md"))
    else:
        files = [root / pattern]
    out = []
    for p in files:
        if not p.exists():
            log("  ⚠️ 找不到 %s:%s，已跳过" % (src_key, pattern))
            continue
        if p.stat().st_size < MIN_FILE_BYTES:
            continue
        out.append(p)
    return out


def make_id(*parts):
    return hashlib.sha1("::".join(parts).encode("utf-8")).hexdigest()[:12]


def finish_md(md, src_key, rel):
    md = convert_containers(md)
    md = rewrite_links(md, src_key, rel)
    return tidy(md)


def build_curated(bank, questions, seen_ids):
    seen_files = set()
    for group in bank["groups"]:
        count = 0
        for src_key, pattern in group["files"]:
            for path in expand(src_key, pattern):
                rel = path.relative_to(SOURCES[src_key]["dir"]).as_posix()
                if (src_key, rel) in seen_files:
                    continue  # 通配符可能和前面单独列出的文件重复
                seen_files.add((src_key, rel))
                text = read(path)
                if src_key == "agentguide":
                    doc_title, items = parse_q_doc(text)
                else:
                    doc_title, items = parse_heading_doc(text, rel)
                for it in items:
                    qid = make_id(src_key, rel, it["title"])
                    n = 1
                    while qid in seen_ids:
                        n += 1
                        qid = make_id(src_key, rel, it["title"], str(n))
                    seen_ids.add(qid)
                    q = {
                        "id": qid,
                        "g": group["id"],
                        "cat": it["cat"] or doc_title,
                        "title": it["title"],
                        "src": src_key,
                        "url": source_url(src_key, rel),
                        "doc": doc_title,
                        "md": finish_md(it["md"], src_key, rel),
                    }
                    if it.get("statement"):
                        q["stmt"] = finish_md(it["statement"], src_key, rel)
                    if it.get("star"):
                        q["star"] = 1
                    if it.get("meta"):
                        q["meta"] = it["meta"]
                    questions.append(q)
                    count += 1
        group["count"] = count
        del group["files"]


def build_carl(bank, questions, seen_ids):
    root = SOURCES["carl"]["dir"]
    readme = read(root / "README.md")
    groups = []
    cur = None
    seen_paths = set()
    for line in readme.split("\n"):
        m = re.search(r"<summary><b>(.+?)</b></summary>", line)
        if m:
            name = m.group(1).strip()
            cur = None if name in CARL_SKIP_GROUPS else {"id": "lc-%d" % (len(groups) + 1), "name": name, "count": 0}
            if cur:
                groups.append(cur)
            continue
        if cur is None:
            continue
        for lm in re.finditer(r"\]\(\./(problems/[^)]+?\.md)\)", line):
            rel = urllib.parse.unquote(lm.group(1))
            if rel in seen_paths:
                continue
            seen_paths.add(rel)
            path = root / rel
            if not path.exists():
                continue
            p = parse_problem(read(path), rel)
            if not p:
                continue
            qid = make_id("carl", rel)
            seen_ids.add(qid)
            q = {
                "id": qid,
                "g": cur["id"],
                "cat": cur["name"],
                "title": p["title"],
                "src": "carl",
                "url": source_url("carl", rel),
                "stmt": finish_md(p["statement"], "carl", rel),
                "md": finish_md(p["md"], "carl", rel),
            }
            if p["link"]:
                q["link"] = p["link"]
            if p["langs"]:
                q["langs"] = {k: finish_md(v, "carl", rel) for k, v in p["langs"].items()}
            questions.append(q)
            cur["count"] += 1
    bank["groups"] = [g for g in groups if g["count"]]


def build(update=False):
    t0 = time.time()
    CACHE.mkdir(exist_ok=True)
    DATA.mkdir(exist_ok=True)
    log("① 同步内容仓库")
    for key in SOURCES:
        sync_source(key, update)
    fetch_vendor()

    log("② 解析题目")
    banks = json.loads(json.dumps(BANKS))  # 深拷贝，避免改到模板
    questions = []
    seen_ids = set()
    for bank in banks:
        if bank["id"] == "lc":
            build_carl(bank, questions, seen_ids)
        else:
            build_curated(bank, questions, seen_ids)
        bank["groups"] = [g for g in bank["groups"] if g.get("count")]
        log("  %s：%d 组，%d 题" % (bank["name"], len(bank["groups"]), sum(g["count"] for g in bank["groups"])))

    out = {
        "generated": time.strftime("%Y-%m-%d %H:%M"),
        "sources": {
            k: {"name": s["name"], "repo": s["repo"], "commit": s["commit"], "date": s["date"]}
            for k, s in SOURCES.items()
        },
        "banks": banks,
        "questions": questions,
    }
    target = DATA / "bank.json"
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(target)
    no_ans = sum(1 for q in questions if not q["md"])
    log("③ 完成：共 %d 题（其中 %d 题源仓库没有参考答案），用时 %.0f 秒" % (len(questions), no_ans, time.time() - t0))
    return target


if __name__ == "__main__":
    build(update="--update" in sys.argv)
