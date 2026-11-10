"""AI 封面 prompt 构建测试：方案素材必须真的进 prompt，不同剧本必出不同图。"""

from __future__ import annotations

from agents._lib.cover import (
    build_cover_prompt,
    pick_hero,
    pick_prop,
    pick_scene,
)

PLAN = {
    "title": "雪落无声的第七夜",
    "background": "背景：暴雪封山的云顶山庄，一场寿宴变成告别。\n其余背景……",
    "victim": {"name": "顾寒山", "scene": "反锁的书房，壁炉将熄"},
    "characters": [
        {"name": "周慈", "identity": "管家", "look": ""},
        {"name": "白棠", "identity": "养女", "look": "二十五岁，黑长直发，深灰色大衣"},
        {"name": "沈墨", "identity": "医生", "look": "四十岁，花白背头，白大褂"},
    ],
    "clues_public": [
        {"id": "C1", "name": "调快的怀表", "points_to": "指向白棠"},
        {"id": "C2", "name": "白棠的证词", "points_to": "不在场证明"},
        {"id": "C3", "name": "壁炉里烧剩的信", "points_to": "作案手法"},
    ],
    "clues_deep": [{"id": "D1", "name": "内壁残留苦味的药瓶", "points_to": "毒物来源"}],
}

BRIEF = {"genre": "本格", "era": "民国", "players": "6人"}


def test_character_prompt_注入角色外形锚点() -> None:
    spec = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN)
    # 外形锚点优先：第一个有 look 的角色是白棠，不是排第一的周慈
    assert "黑长直发" in spec["prompt"]
    assert "深灰色大衣" in spec["prompt"]
    assert "养女" in spec["prompt"]


def test_character_prompt_注入真实道具而非写死的怀表三件套() -> None:
    spec = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN)
    assert "调快的怀表" in spec["prompt"]
    # 旧模板的写死文案不应再出现
    assert "怀表/信件/匕首" not in spec["prompt"]
    assert "老宅走廊与暗红帷幔" not in spec["prompt"]


def test_character_prompt_注入现场与题材时代() -> None:
    spec = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN)
    assert "反锁的书房" in spec["prompt"]
    assert "本格题材" in spec["prompt"]
    assert "民国背景" in spec["prompt"]


def test_character_prompt_抽象线索不充当道具() -> None:
    plan = {"clues_public": [{"id": "C1", "name": "白棠的证词"}, {"id": "C2", "name": "不在场证明"}]}
    spec = build_cover_prompt("character", "某本", {}, plan)
    assert "证词" not in spec["prompt"]
    # 兜底文案不写死具体道具
    assert "贴合剧情的关键道具" in spec["prompt"]


def test_seed_不同剧本必不同_同剧本稳定() -> None:
    a = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN)
    b = build_cover_prompt("character", "断电七分钟", BRIEF, PLAN)
    c = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN)
    d = build_cover_prompt("scene", "雪落无声的第七夜", BRIEF, PLAN)
    assert a["seed"] != b["seed"]
    assert a["seed"] == c["seed"]
    assert a["seed"] != d["seed"]  # 风格也参与哈希
    assert 0 <= a["seed"] < 2**31


def test_group_人数来自方案不写死五人() -> None:
    spec = build_cover_prompt("group", "雪落无声的第七夜", BRIEF, PLAN)
    assert "围坐6人" in spec["prompt"]
    assert "五人" not in spec["prompt"]
    assert "反锁的书房" in spec["prompt"]


def test_group_人数上限收在3到8() -> None:
    plan = {"characters": [{"name": f"角色{i}"} for i in range(12)]}
    spec = build_cover_prompt("group", "某本", {}, plan)
    assert "围坐8人" in spec["prompt"]
    brief = {"players": "2人"}
    spec2 = build_cover_prompt("group", "某本", brief, {})
    assert "围坐3人" in spec2["prompt"]


def test_scene_prompt_不含标题文字_防止模型画字() -> None:
    spec = build_cover_prompt("scene", "雪落无声的第七夜", BRIEF, PLAN)
    assert "雪落无声的第七夜" not in spec["prompt"]
    assert "反锁的书房" in spec["prompt"]


def test_空方案优雅退化不抛错() -> None:
    for style in ("character", "group", "scene"):
        spec = build_cover_prompt(style, "未命名", None, None)
        assert spec["prompt"]
        assert spec["negative"]
    # 兜底现场描述仍然给画面留了内容
    spec = build_cover_prompt("character", "未命名", {}, {})
    assert "暗色帷幔" in spec["prompt"]


def test_长背景截断不灌爆prompt() -> None:
    brief = {"era": "", "background": "这是一个非常长的背景设定" * 10}
    spec = build_cover_prompt("character", "某本", brief, {})
    assert len(spec["prompt"]) < 600


def test_pick_hero_三级退路() -> None:
    # 有 look 的优先
    assert pick_hero(PLAN)["name"] == "白棠"
    # 没 look 就挑有身份的
    plan = {"characters": [{"name": "甲"}, {"name": "乙", "identity": "医生"}]}
    assert pick_hero(plan)["name"] == "乙"
    # 都没有就第一个
    plan = {"characters": [{"name": "甲"}, {"name": "乙"}]}
    assert pick_hero(plan)["name"] == "甲"
    assert pick_hero({}) == {}


def test_pick_scene_现场优先_背景退路去掉行首标签() -> None:
    assert pick_scene(PLAN) == "反锁的书房，壁炉将熄"
    assert pick_scene({"background": "背景：暴雪封山的云顶山庄"}) == "暴雪封山的云顶山庄"
    assert pick_scene({}) == ""
