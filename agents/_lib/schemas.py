"""LLM 结构化输出模型。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class BriefPatch(BaseModel):
    """一轮对话中抽取出的需求增量。"""

    intent: Literal["new", "iterate", "question"] = Field(
        description="new=首次出完整方案或要求推翻重做；iterate=在现有方案上调整；question=咨询/追问/点评，不需要重做完整方案。"
    )
    genre: str = Field(default="", description="题材：本格/变格/民国/古风/现代/科幻等，未提及留空。")
    players: str = Field(default="", description="人数偏好，如 6人/4-6人，未提及留空。")
    difficulty: str = Field(default="", description="难度：新手/进阶/硬核/地狱，未提及留空。")
    trick_types: list[str] = Field(default_factory=list, description="想要的诡计类型，如 密室/不在场证明/叙诡/时间诡计/身份诡计。")
    special: str = Field(default="", description="特殊设定，如 暴风雪山庄/循环/双线叙事/禁止超自然。")
    modifications: list[str] = Field(default_factory=list, description="本轮明确要求的具体改动。")
    story_title: str = Field(default="", description="用户指定的剧本名，未指定留空。")


class VictimInfo(BaseModel):
    name: str
    identity: str = Field(description="身份、与在场者的关系。")
    death_time: str = Field(description="剧本内死亡时间，例如 第一幕 21:40。")
    cause: str = Field(description="克制的死因描述，不写伤害细节。")
    scene: str = Field(description="现场状态的结果性描述，不写血腥细节。")
    found_by: str = Field(description="发现者与发现方式。")


class TrickCore(BaseModel):
    name: str = Field(description="诡计名称。")
    category: str = Field(description="密室/不在场证明/叙诡/时间诡计/身份诡计等。")
    steps: list[str] = Field(description="3-7 步手法拆解，必须在剧本内成立。")
    principle: str = Field(description="诡计成立的底层原理。")
    why_works: str = Field(description="为什么玩家会误判。")
    risks: list[str] = Field(description="最容易崩盘的风险点。")
    reality_safety: str = Field(description="现实不可复刻说明：说明依赖哪些虚构条件，现实中无法照做。")


class CulpritInfo(BaseModel):
    character: str
    motive: str
    opportunity: str
    method: str
    cover_up: list[str] = Field(default_factory=list)
    evidence_chain: list[str] = Field(description="从公开线索到锁凶的推理链，至少 3 环。")


class CharacterInfo(BaseModel):
    name: str
    identity: str
    secret: str
    suspicion: str = Field(description="该角色被怀疑的点，以及可被哪些线索排除。")


class ClueInfo(BaseModel):
    id: str = Field(description="线索编号，如 C1 / D1。")
    name: str
    content: str
    points_to: str = Field(description="指向谁 / 排除谁。")
    access: str = Field(description="玩家如何获得：公开阅读/搜证位置/DM 发放。")
    why_fair: str = Field(description="为什么这条线索对所有玩家可获得，而不是上帝视角。")


class TimelineItem(BaseModel):
    time: str
    event: str
    witness: str = Field(description="可验证方式/证人。")
    visibility: Literal["公开", "深入"] = Field(description="该时间点玩家是否可直接获得。")


class RedHerring(BaseModel):
    description: str
    misleading: str
    clear_method: str = Field(description="用哪条线索、如何排除，不能靠 DM 口头解释。")


class DesignPlan(BaseModel):
    title: str
    tagline: str = Field(description="一句话卖点，20 字以内。")
    victim: VictimInfo
    background: str
    core_trick: TrickCore
    culprit: CulpritInfo
    characters: list[CharacterInfo]
    clues_public: list[ClueInfo]
    clues_deep: list[ClueInfo]
    timeline: list[TimelineItem]
    red_herrings: list[RedHerring]
    dm_tips: list[str]
    anti_argument: list[str]
    player_traps: list[str]
    iteration_hooks: list[str] = Field(description="后续可加的难度/反转方向。")
    self_audit: FairnessAudit | None = Field(
        default=None,
        description="完成方案后立即做公平性自查并填入：锁凶充分性评分、是否降智、其他解释与修复建议。填了此字段系统将跳过独立审查以提速。",
    )


class ClueCard(BaseModel):
    """轻量线索卡：供流式架构下从 Markdown 提取。"""

    id: str = Field(description="线索编号，如 C1 / D1。")
    name: str
    content: str
    points_to: str = Field(description="指向谁 / 排除谁。")
    access: str = Field(default="", description="玩家如何获得。")


class DigestCharacter(BaseModel):
    name: str
    identity: str
    secret: str
    suspicion: str


class DigestTimeline(BaseModel):
    time: str
    event: str
    witness: str = Field(default="", description="可验证方式/证人。")
    visibility: str = Field(default="公开", description='只能是「公开」或「深入」，不要写其他文字。')


class PlanDigest(BaseModel):
    """从流式 Markdown 方案中提取的轻量结构化摘要（供线索卡/沉浸模式/导出使用）。"""

    title: str
    tagline: str = Field(default="", description="一句话卖点。")
    victim_name: str = ""
    victim_identity: str = ""
    victim_death_time: str = ""
    victim_scene: str = ""
    background: str = Field(default="", description="案发背景，2-3 句话概括。")
    core_trick_name: str = ""
    core_trick_category: str = ""
    core_trick_steps: list[str] = Field(default_factory=list, description="手法拆解，每步一句话。")
    core_trick_principle: str = ""
    reality_safety: str = ""
    culprit: str = Field(default="", description="凶手角色名。")
    culprit_motive: str = ""
    culprit_evidence_chain: list[str] = Field(default_factory=list, description="锁凶证据链，3-5 环。")
    characters: list[DigestCharacter] = Field(default_factory=list)
    clues_public: list[ClueCard] = Field(default_factory=list)
    clues_deep: list[ClueCard] = Field(default_factory=list)
    timeline: list[DigestTimeline] = Field(default_factory=list, description="4-8 条关键时间点。")
    lock_score: int = Field(default=70, ge=0, le=100, description="从自查报告提取的锁凶充分性评分。")
    audit_verdict: str = ""
    must_fix: list[str] = Field(default_factory=list, description="必修问题，每条一句话。")


class QuickQuestions(BaseModel):
    """出方案前的关键追问（最多 3 个）。"""

    questions: list[str] = Field(description="2~3 个关键问题，每个一句话，帮助锁定方案方向。")


class AuditIssue(BaseModel):
    severity: Literal["high", "medium", "low"]
    category: str
    description: str
    fix: str


class FairnessAudit(BaseModel):
    lock_score: int = Field(ge=0, le=100, description="锁凶充分性评分，0-100。")
    sufficient_to_identify: bool
    forced_stupidity: bool = Field(description="是否依赖角色或玩家集体降智才能成立。")
    god_view_only: bool = Field(description="是否只有上帝视角/DM 手册才能破案。")
    alternative_solutions: list[str] = Field(description="玩家可能提出的其他合理解释，以及为何能被排除。")
    issues: list[AuditIssue]
    verdict: str = Field(description="一句话结论。")
    must_fix: list[str] = Field(description="上线前必须修复的 1-3 条。")
