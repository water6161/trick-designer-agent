"""AI 封面 prompt 构建：把方案里的差异化素材（角色外形锚点、真实线索道具、现场）
注入生图提示词，避免「不同剧本、同一张图」。

此前 character 风格的 prompt 只有 genre/era 两个变量，构图与道具全部写死
（怀表/信件/匕首、老宅走廊与暗红帷幔），两个同题材的本会生成几乎相同的画面。
现在：
- 主角形象来自角色表「外形锚点」（年龄/发型发色/体型/服装主色/标志物）
- 道具来自线索表里的真实道具名（不再是写死的怀表）
- 场景来自死者现场的描述
- seed 由 标题+风格 哈希决定：不同剧本必出不同图，同剧本同风格稳定复现
"""

from __future__ import annotations

import re
from typing import Any

# 线索名里这些词是「口头信息」，画出来没有实物感
_ABSTRACT_CLUE_WORDS = (
    "证词",
    "不在场",
    "时间线",
    "动机",
    "秘密",
    "证明",
    "记录",
    "口供",
    "疑点",
    "矛盾",
    "传说",
)

_MAX_SEED = 2**31 - 1


def _fnv1a(text: str) -> int:
    """FNV-1a 32 位哈希（与前端 illustration.ts 的 characterSeed 同族）。"""
    h = 0x811C9DC5
    for ch in text.encode("utf-8"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def pick_hero(plan: dict[str, Any]) -> dict[str, str]:
    """挑封面主角：优先有外形锚点的角色，其次有身份的，再退到第一个角色。"""
    characters = [c for c in (plan.get("characters") or []) if isinstance(c, dict) and c.get("name")]
    if not characters:
        return {}
    for char in characters:
        if str(char.get("look") or "").strip():
            return char
    for char in characters:
        if str(char.get("identity") or "").strip():
            return char
    return characters[0]


def pick_prop(plan: dict[str, Any]) -> str:
    """从线索表挑一件「实物感」道具：线索名短、不含抽象词。公开线索优先。"""
    clues = list(plan.get("clues_public") or []) + list(plan.get("clues_deep") or [])
    for clue in clues:
        if not isinstance(clue, dict):
            continue
        name = str(clue.get("name") or "").strip()
        if not 2 <= len(name) <= 14:
            continue
        if any(word in name for word in _ABSTRACT_CLUE_WORDS):
            continue
        return name
    return ""


def pick_scene(plan: dict[str, Any]) -> str:
    """现场描述：优先死者小节的「现场：」行，否则取背景第一句。"""
    victim = plan.get("victim") or {}
    scene = str(victim.get("scene") or "").strip() if isinstance(victim, dict) else ""
    if scene:
        return scene[:40]
    background = str(plan.get("background") or "").strip()
    if background:
        # 第一行往往带「背景：」前缀之类，统一去掉行首标签
        first_line = background.splitlines()[0].strip()
        first_line = re.sub(r"^[^：:]{1,6}[：:]\s*", "", first_line)
        return first_line[:40]
    return ""


def _players_count(brief: dict[str, Any], plan: dict[str, Any]) -> int:
    players = str(brief.get("players") or brief.get("player_count") or "")
    match = re.search(r"(\d+)\s*人", players)
    if match:
        return max(3, min(int(match.group(1)), 8))
    characters = [c for c in (plan.get("characters") or []) if isinstance(c, dict) and c.get("name")]
    if characters:
        return max(3, min(len(characters), 8))
    return 5


def _era_part(brief: dict[str, Any]) -> str:
    era = str(brief.get("era") or brief.get("background") or "").strip()
    # brief.background 可能是整段设定，只取短句防 prompt 被灌爆
    if len(era) > 30:
        era = era[:30].rstrip("，。；,;")
    return f"，{era}背景" if era else ""


def build_cover_prompt(
    style: str,
    title: str,
    brief: dict[str, Any] | None,
    plan: dict[str, Any] | None,
) -> dict[str, Any]:
    """构建生图请求参数。返回 prompt / negative / seed / model / size。

    plan/brief 缺字段时逐项优雅退化，不抛错——封面生成永远不该因为
    方案解析不全而失败。
    """
    brief = brief if isinstance(brief, dict) else {}
    plan = plan if isinstance(plan, dict) else {}
    genre = str(brief.get("genre") or "").strip()
    genre_part = f"{genre}题材" if genre else "悬疑"
    era_part = _era_part(brief)

    if style == "group":
        count = _players_count(brief, plan)
        scene = pick_scene(plan)
        scene_part = f"，{scene}" if scene else ""
        prompt = (
            f"电影级剧照，{genre_part}{era_part}悬疑群像，昏暗长桌旁围坐{count}人，"
            f"{count}人年龄性别身份各不相同、服装贴合时代背景{scene_part}，"
            "各怀心思互不对视，烛光单一光源从桌面升起照亮各人面部，"
            "背景深色木墙与阴影，胶片颗粒，褪色色调，强烈明暗对比，"
            "摄影级画质，画面留有顶部标题空间，画面中无任何文字水印"
        )
        model = "wan2.5-t2i-preview"
        size = "960*1280"
    elif style == "scene":
        scene = pick_scene(plan)
        scene_part = f"，画面核心场景：{scene}" if scene else ""
        prompt = (
            f"剧本杀游戏封面插画，{genre_part}{era_part}，悬疑惊悚氛围{scene_part}，"
            "深蓝夜色与暗红色调，电影级光影，戏剧性构图，细节丰富，"
            "高清大师级插画画质，画面中不要出现任何文字、字母或水印"
        )
        model = "wanx2.1-t2i-turbo"
        size = "720*960"
    else:  # character（默认）：主角人物海报
        hero = pick_hero(plan)
        look = str(hero.get("look") or "").strip() if hero else ""
        identity = str(hero.get("identity") or "").strip() if hero else ""
        # 主角描述：外形锚点是现成的生图描述（年龄/发型发色/服装主色/标志物）
        hero_desc = ""
        if identity:
            hero_desc += f"{identity}，"
        hero_desc += look if look else "一位主角"
        prop = pick_prop(plan)
        prop_desc = f"手中握着关键道具（{prop}）" if prop else "手中握着一件贴合剧情的关键道具"
        scene = pick_scene(plan)
        scene_desc = f"背景是虚化的{scene}" if scene else "背景是虚化的室内环境与暗色帷幔"
        prompt = (
            f"电影级剧本杀海报，{genre_part}{era_part}悬疑剧照风格，"
            f"{hero_desc}，半身特写占据画面右侧三分之二，侧身回望镜头，眼神沉静而锐利，"
            f"{prop_desc}，"
            "单一冷光从左上方打在脸侧，另半边脸沉入阴影，"
            f"{scene_desc}，强烈明暗对比，"
            "胶片颗粒质感，褪色色调，画面留有干净的标题区，"
            "高度写实，摄影级画质，画面中无任何文字水印"
        )
        model = "wan2.5-t2i-preview"
        size = "960*1280"

    negative = (
        "文字, 字母, 水印, 血腥, 恐怖恶心, 低质量, 模糊, 变形, 多余手指, 面部扭曲, 脸部畸形, 五官错位"
        + (", 卡通, 动漫, 二次元, 平面插画, 拼贴, 分格" if style != "scene" else "")
    )
    # seed 由标题+风格决定：换剧本必换图；同剧本同风格可复现
    seed = _fnv1a(f"{title}|{style}") % _MAX_SEED
    return {"prompt": prompt, "negative": negative, "seed": seed, "model": model, "size": size}
