"""从流式 Markdown 正文解析结构化方案。

为什么单独成模块：
- 这段逻辑原来埋在 app.py 里，只有导出接口能用；
- 现在 verify 节点（硬规则校验）在 extract 提取失败时也需要它，
  放在 app.py 会让 nodes 反向依赖入口文件，形成循环依赖；
- 抽出来之后它是纯函数，可以直接单测，不用起 HTTP 服务。

解析策略是「宽松兜底」：宁可少解析几个字段，也不要抛异常。
正文已经展示给用户了，少一张卡片不算失败。
"""

from __future__ import annotations

import re
from typing import Any


def md_rows(text: str) -> list[list[str]]:
    """解析 Markdown 表格行为二维数组，自动跳过分隔行。"""
    rows: list[list[str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells and all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        if any(c for c in cells):
            rows.append(cells)
    return rows


def md_section(md: str, name: str) -> str:
    """取 `## name...` 到下一个二级标题之间的内容。"""
    match = re.search(rf"^##\s*{re.escape(name)}[^\n]*\n(.*?)(?=^##\s|\Z)", md, re.M | re.S)
    return match.group(1) if match else ""


def md_subsection(md: str, name: str) -> str:
    """取 `### name...` 到下一个二级/三级标题之间的内容。"""
    match = re.search(rf"^###\s*{re.escape(name)}[^\n]*\n(.*?)(?=^##[#]?[^\n]|\Z)", md, re.M | re.S)
    return match.group(1) if match else ""


def md_table_after(md: str, name: str) -> str:
    """取「name 小节」之后的表格文本；小节缺失时从 name 之后全局找第一张表。"""
    text = md_subsection(md, name)
    if md_rows(text):
        return text
    match = re.search(rf"{re.escape(name)}[^\n]*\n(.*?)(?=^##[#]?[^\n]|\Z)", md, re.M | re.S)
    return match.group(1) if match else text


def rows_to_objects(rows: list[list[str]]) -> list[dict[str, str]]:
    """把「表头/表头/…」的表格转成对象列表。"""
    if len(rows) < 2:
        return []
    header = [h.replace("*", "").strip() for h in rows[0]]
    return [
        {header[i]: cells[i] for i in range(min(len(header), len(cells))) if header[i]}
        for cells in rows[1:]
    ]


def _first(mapping: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = mapping.get(key)
        if value:
            return value
    return ""


def parse_plan_from_markdown(md: str) -> dict[str, Any]:
    """把方案正文解析成与 PlanDigest 同构的字典（字段能取多少取多少）。"""
    plan: dict[str, Any] = {}
    if not md:
        return plan

    title_match = re.search(r"^#\s*[《\"]?([^《》\n]{2,40})[》\"]?", md, re.M)
    if title_match:
        plan["title"] = title_match.group(1).strip()
    tagline_match = re.search(r"^>\s*([^>\n]{6,60})$", md, re.M)
    if tagline_match and "声明" not in tagline_match.group(1):
        plan["tagline"] = tagline_match.group(1).strip()

    # 背景与死者（第二节）
    body = md_section(md, "二")
    if body:
        paras = [
            p.strip()
            for p in re.split(r"\n\s*\n|\n(?=[^\n|]{8,}：)", body)
            if p.strip() and not p.strip().startswith("|")
        ]
        plan["background"] = "\n".join(paras)[:800]
        victim_text = "\n".join(
            line.strip() for line in body.splitlines() if line.strip() and not line.strip().startswith("|")
        )
        victim: dict[str, str] = {}
        for pattern, key in (
            (r"死者[：:]\s*([^\n，,（(。]{2,12})", "name"),
            (r"身份[：:]\s*([^\n]{2,30})", "identity"),
            (r"死亡时间[：:]\s*([^\n]{2,20})", "death_time"),
            (r"现场[：:]\s*([^\n]{2,80})", "scene"),
            (r"发现[：:]\s*([^\n]{2,60})", "found_by"),
        ):
            match = re.search(pattern, victim_text)
            if match:
                victim[key] = match.group(1).strip()
        if victim:
            plan["victim"] = victim

    # 凶手与角色（第四节；分段生成时「## 四」标题可能省略，直接全局找子标题）
    culprit_text = md_subsection(md, "凶手")
    if culprit_text:
        name_match = (
            re.search(r"凶手[：:]\s*([^\n，,（(。]{2,12})", culprit_text)
            or re.search(r"凶手[：:]\s*([^\n，,（(。]{2,12})", md)
            or re.match(r"^\s*([^\n，,（(。：:]{2,12})", culprit_text)
        )
        plan["culprit"] = {
            "character": name_match.group(1).strip() if name_match else "",
            "motive": culprit_text[:400],
        }
    char_table = rows_to_objects(md_rows(md_table_after(md, "角色表")))
    plan["characters"] = [
        {
            "name": _first(row, "角色", "姓名", "名字"),
            "identity": _first(row, "身份"),
            "secret": _first(row, "秘密"),
            "suspicion": _first(row, "被怀疑点", "怀疑点"),
            "look": _first(row, "外形锚点", "外形", "视觉锚点"),
        }
        for row in char_table
    ]

    # 线索（第五节）
    for key, sub in (("clues_public", "公开线索"), ("clues_deep", "深入线索")):
        rows = rows_to_objects(md_rows(md_table_after(md, sub)))
        plan[key] = [
            {
                "id": _first(row, "编号"),
                "name": _first(row, "线索", "名称", "线索内容"),
                "content": _first(row, "线索内容", "内容", "线索"),
                "points_to": _first(row, "指向或排除", "指向"),
                "access": _first(row, "获取方式"),
                "why_fair": _first(row, "为什么公平"),
            }
            for row in rows
        ]

    # 时间线（第六节）
    tl_rows = rows_to_objects(md_rows(md_section(md, "六")))
    plan["timeline"] = [
        {
            "time": _first(row, "时间"),
            "event": _first(row, "事件"),
            "witness": _first(row, "可验证方式", "可验证"),
            "visibility": "深入" if "深入" in (row.get("公开或深入") or "") else "公开",
        }
        for row in tl_rows
    ]

    # 结局分支（可选章节；旧方案没有就不产出该字段，verify 也按「可选」处理）
    ending_rows = rows_to_objects(md_rows(md_table_after(md, "结局分支")))
    endings = [
        {
            "name": _first(row, "结局", "结局名", "分支"),
            "condition": _first(row, "触发条件", "条件", "达成条件"),
            "clues": _first(row, "支撑线索", "线索"),
            "outcome": _first(row, "走向", "结局走向", "结局内容"),
        }
        for row in ending_rows
    ]
    if endings:
        plan["endings"] = endings

    score_match = re.search(r"锁凶充分性评分[：:]\s*(\d{1,3})\s*/\s*100", md)
    if score_match:
        plan["lock_score"] = int(score_match.group(1))
    return plan
