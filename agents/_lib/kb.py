"""本地知识库检索：精选语料按关键词匹配，注入 design 节点。

语料位于本目录 knowledge/ 下，格式约定（每个 .md 文件）：

    # 标题
    tags: 标签1, 标签2
    ---
    正文……

- tags 行用于精确加权匹配；正文按关键词出现次数计分。
- 语料只收录「手法、结构、思路」层面的原创整理，不收录任何受版权保护的剧本原文。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

_KB_DIR = Path(__file__).parent / "knowledge"
_CACHE: list[dict[str, Any]] | None = None

# 常见需求词 → 语料标签的归一化映射（用户说"暴风雪山庄"也能命中 "封闭场景"）
_KEYWORD_ALIASES: dict[str, list[str]] = {
    "密室": ["密室"],
    "暴风雪山庄": ["封闭场景", "经典结构"],
    "孤岛": ["封闭场景", "经典结构"],
    "山庄": ["封闭场景", "经典结构"],
    "古堡": ["封闭场景"],
    "游轮": ["封闭场景"],
    "雪村": ["封闭场景"],
    "不在场证明": ["不在场证明"],
    "时间诡计": ["不在场证明", "时间诡计"],
    "叙述性诡计": ["叙诡"],
    "叙诡": ["叙诡"],
    "身份": ["叙诡", "身份诡计"],
    "换尸": ["叙诡", "身份诡计"],
    "双胞胎": ["身份诡计"],
    "变格": ["变格", "氛围"],
    "恐怖": ["氛围"],
    "怪谈": ["氛围", "民俗"],
    "民俗": ["民俗"],
    "民国": ["氛围", "民国"],
    "古风": ["氛围"],
    "校园": ["氛围"],
    "本格": ["本格", "经典结构"],
    "红鲱鱼": ["经典结构"],
    "循环": ["经典结构"],
}


def _load_docs() -> list[dict[str, Any]]:
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    docs: list[dict[str, Any]] = []
    if _KB_DIR.is_dir():
        for path in sorted(_KB_DIR.glob("*.md")):
            try:
                raw = path.read_text(encoding="utf-8")
            except Exception:
                continue
            title = path.stem
            tags: list[str] = []
            body = raw
            m = re.match(r"#\s*(.+)", raw)
            if m:
                title = m.group(1).strip()
            mt = re.search(r"^tags[:：]\s*(.+)$", raw, flags=re.M)
            if mt:
                tags = [t.strip() for t in re.split(r"[,，]", mt.group(1)) if t.strip()]
            sep = re.search(r"^---\s*$", raw, flags=re.M)
            if sep:
                body = raw[sep.end():].strip()
            docs.append({"title": title, "tags": tags, "body": body, "source": path.name})
    _CACHE = docs
    return docs


def _query_terms(brief: dict[str, Any]) -> list[str]:
    terms: list[str] = []
    for value in (
        brief.get("genre"),
        brief.get("difficulty"),
        brief.get("special"),
        brief.get("story_title"),
    ):
        text = str(value or "").strip()
        if text:
            terms.append(text)
    for item in brief.get("trick_types") or []:
        text = str(item or "").strip()
        if text:
            terms.append(text)
    for item in brief.get("modifications") or []:
        text = str(item or "").strip()
        if text:
            terms.append(text)
    return terms


def retrieve_knowledge(brief: dict[str, Any], *, top_k: int = 3, max_chars: int = 2600) -> list[dict[str, str]]:
    """按需求关键词检索知识库，返回 [{title, content}]。"""
    docs = _load_docs()
    if not docs:
        return []

    wanted_tags: set[str] = set()
    terms = _query_terms(brief)
    for term in terms:
        for alias, tags in _KEYWORD_ALIASES.items():
            if alias in term:
                wanted_tags.update(tags)

    scored: list[tuple[float, dict[str, Any]]] = []
    for doc in docs:
        score = 0.0
        tag_hits = wanted_tags & set(doc["tags"])
        score += 3.0 * len(tag_hits)
        for term in terms:
            if len(term) >= 2:
                if term in doc["title"]:
                    score += 2.0
                if term in doc["body"]:
                    score += 1.0
        # 任何文档至少给基础分，保证无关键词时也有兜底参考
        if score > 0:
            scored.append((score, doc))
    scored.sort(key=lambda pair: pair[0], reverse=True)

    results: list[dict[str, str]] = []
    for score, doc in scored[:top_k]:
        body = doc["body"][:max_chars]
        results.append({"title": doc["title"], "content": body})
    return results
