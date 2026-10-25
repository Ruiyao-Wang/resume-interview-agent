"""Deterministic offline demonstration, explicitly not a semantic LLM or verifier."""
from __future__ import annotations

import re
from typing import TypeVar

from pydantic import BaseModel

try:
    from ..matcher import CONCEPT_ALIASES, tokenize
except ImportError:  # app can be launched as backend/app.py or backend.app
    from matcher import CONCEPT_ALIASES, tokenize

from .schemas import Education, Experience, JDData, MatchAnalysis, MatchPoint, Question, QuestionSet, Requirement, ResumeData, Evaluation, Dimensions

Model = TypeVar("Model", bound=BaseModel)
EXTRA_SKILLS = ("FastAPI", "Pydantic", "SQLite", "Docker", "HTTP", "REST", "NumPy", "pandas", "TensorBoard", "ONNX", "pytest", "JMeter", "Locust")
HEADINGS = {
    "education": r"教育(?:经历|背景)?|学历|education(?:al background)?",
    "skills": r"专业技能|技能(?:证书|与工具)?|技术技能|skills?|technical skills",
    "internships": r"实习(?:经历|经验)?|工作(?:经历|经验)?|internships?|work experience|professional experience",
    "projects": r"项目(?:经历|经验|实践)?|科研(?:经历|经验)?|课程项目|projects?|project experience|research experience",
}
POINTS = {
    "Python": ["可变与不可变对象及引用", "异常处理与资源释放", "用边界条件验证代码"],
    "PyTorch": ["Tensor 形状与自动求导", "训练和评估模式的区别", "梯度更新和数据集划分"],
    "语义分割": ["逐像素类别预测", "IoU 与 mIoU 的计算含义", "类别不平衡和错误样本分析"],
    "模型评测": ["独立测试集和数据泄漏", "指标选择与业务目标", "分场景误差分析"],
    "数据泄漏": ["训练验证测试集职责", "按主体或时间分组划分", "检查跨集合重复样本"],
    "SQL": ["连接查询与聚合", "索引和查询执行计划", "事务与数据一致性"],
    "MySQL": ["连接查询与聚合", "索引和查询执行计划", "事务与数据一致性"],
    "自动化测试": ["正常异常与边界测试用例", "可重复的测试数据和断言", "回归测试与失败定位"],
    "性能测试": ["并发量吞吐量和延迟", "可重复的负载与测量条件", "瓶颈定位与优化验证"],
    "Linux": ["进程和文件权限", "日志与资源使用情况", "定位问题时的排查顺序"],
    "Git": ["提交分支与合并", "冲突解决与变更审查", "敏感文件不入库"],
    "大语言模型": ["上下文与输出不确定性", "结构化输出校验和重试", "提示注入与隐私保护"],
    "无线通信": ["信噪比与误码率", "信道条件和链路预算", "仿真与实测的差别"],
    "链路预算": ["发射接收增益和传播损耗", "噪声与链路余量", "假设条件和单位核对"],
}


def skills_in(text: str, reject_negated: bool = False) -> list[str]:
    features = tokenize(text)
    result = [skill for skill in CONCEPT_ALIASES if skill in features]
    result.extend(skill for skill in EXTRA_SKILLS if re.search(r"(?<![a-z0-9])" + re.escape(skill) + r"(?![a-z0-9])", text, re.I))
    result = list(dict.fromkeys(result))[:80]
    if reject_negated:
        positive = []
        for skill in result:
            aliases = CONCEPT_ALIASES.get(skill, (skill,))
            affirmed = False
            for alias in aliases:
                pattern = r"(?<![a-z0-9_+#])" + re.escape(alias) + r"(?![a-z0-9_+#])"
                for occurrence in re.finditer(pattern, text, re.I):
                    preceding = text[max(0, occurrence.start() - 24):occurrence.start()]
                    if not re.search(r"(?:不会|不熟悉|未掌握|没有|暂无|未学习|未学过|不懂|不了解|不具备|no experience with|not familiar with)[^，,。;；\n]{0,12}$", preceding, re.I):
                        affirmed = True
            if affirmed:
                positive.append(skill)
        return positive
    return result


def lines_of(text: str) -> list[str]:
    return [re.sub(r"^[\s•·●\-*]+", "", line).strip() for line in text.splitlines() if line.strip()]


def sections_of(text: str) -> dict[str, list[str]]:
    sections = {key: [] for key in HEADINGS}
    section = ""
    for line in lines_of(text):
        found = False
        for key, pattern in HEADINGS.items():
            match = re.match(r"^(?:" + pattern + r")\s*(?:[:：]\s*(.*))?$", line, re.I)
            if match:
                section = key
                if match.group(1):
                    sections[key].append(match.group(1))
                found = True
                break
        if not found and section:
            sections[section].append(line)
    return sections


def experiences(lines: list[str]) -> list[Experience]:
    lines = [line for line in lines if not re.fullmatch(r"(?:暂无|无|没有|未提供)(?:正式|相关)?(?:实习|工作|项目)?(?:经历|经验)?[。.!！]?|none|n/a", line, re.I)
             and not re.match(r"(?:说明|备注|注)[：:]", line)]
    if not lines:
        return []
    # Keep original evidence grouped around explicit dated/title entries. Do not
    # turn a sentence into a fictitious organization, role or achievement.
    groups: list[list[str]] = []
    for line in lines:
        title_like = len(line) <= 100 and re.search(r"(?:课程项目|毕业设计|研究项目|系统|项目|实习)$", line) and not re.search(r"[，,。；;：:]|负责|使用|参与", line)
        if not groups or ((re.match(r"^(?:20\d{2}[./年-]|项目[一二三四五12345]?[：:]|实习[：:])", line) or title_like) and len(groups[-1]) > 1):
            groups.append([line])
        else:
            groups[-1].append(line)
    return [Experience(title=group[0][:150], summary="\n".join(group)[:2500],
                       technologies=skills_in("\n".join(group))[:30], evidence="\n".join(group)[:3000]) for group in groups[:30]]


def parse_resume(payload: dict) -> ResumeData:
    text = payload["text"]
    lines = lines_of(text)
    sections = sections_of(text)
    education = []
    education_lines = sections["education"] or [line for line in lines if re.search(r"大学|学院|University|College", line, re.I)]
    for line in education_lines:
        school = re.search(r"([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z ·.-]*(?:大学|学院)|(?:University|College)\s+of\s+[A-Za-z ]+|[A-Za-z ]+(?:University|College))", line, re.I)
        if not school:
            continue
        degree = re.search(r"博士|硕士|本科|学士|大专|Ph\.?D\.?|Master(?:'s)?|Bachelor(?:'s)?", line, re.I)
        major = re.search(r"(?:专业[：:]\s*([^，,;；|]+)|([\u4e00-\u9fff]{2,15})专业)", line)
        dates = re.findall(r"20\d{2}(?:[./-]\d{1,2}|年\d{1,2}月)?", line)
        education.append(Education(school=school.group(1).strip(), degree=degree.group(0) if degree else "",
                                   major=(major.group(1) or major.group(2)).strip() if major else "",
                                   start_date=dates[0] if dates else "", end_date=dates[1] if len(dates) > 1 else "",
                                   evidence=line))
    name_match = re.search(r"(?:姓名|name)\s*[:：]\s*([^\n,，|]{1,60})", text, re.I)
    name = name_match.group(1).strip() if name_match else ""
    if not name and lines and re.fullmatch(r"[\u4e00-\u9fff]{2,4}", lines[0]) and lines[0] not in {"个人简历", "示例简历", "教育经历"}:
        name = lines[0]
    warnings = ["Mock 演示：使用规则提取，不代表大模型语义解析；请核对分段和字段。"]
    if not sections["projects"] and not sections["internships"]:
        warnings.append("未识别到明确的项目/实习标题；建议使用标准章节标题后重试。")
    skills = skills_in(text, reject_negated=True)
    if set(skills_in(text)) - set(skills):
        warnings.append("已忽略明确否定的技能表述；规则无法识别所有语义边界，请核对技能清单。")
    return ResumeData(name=name, education=education[:20], skills=skills,
                      internships=experiences(sections["internships"]), projects=experiences(sections["projects"]), warnings=warnings)


def parse_jd(payload: dict) -> JDData:
    lines = lines_of(payload["text"])
    title = re.sub(r"^(?:岗位|职位|职位名称|岗位名称)[：:]\s*", "", lines[0])[:200] if lines else "待确认岗位"
    requirements = []
    responsibilities = []
    seen = set()
    for line in lines[1:] or lines:
        if re.fullmatch(r"岗位要求|任职要求|岗位职责|工作职责|requirements|responsibilities", line, re.I):
            continue
        if re.search(r"负责|参与|承担|开展|设计|维护|responsib", line, re.I):
            responsibilities.append(line[:1000])
        topics = skills_in(line)
        if not topics:
            topics = [line[:100]]
        for topic in topics:
            if topic in seen or len(requirements) >= 40:
                continue
            seen.add(topic)
            requirements.append(Requirement(topic=topic, description=line[:1000], evidence=line[:1000],
                                            priority="preferred" if re.search(r"优先|加分|preferred|nice.to.have", line, re.I) else "must"))
    if not requirements:
        requirements = [Requirement(topic="岗位描述", description=payload["text"][:1000], evidence=payload["text"][:1000])]
    return JDData(title=title, requirements=requirements, responsibilities=responsibilities[:30],
                  warnings=["Mock 演示：岗位要求为关键词/行级规则提取，请检查必需和优先项。"])


def match_resume(payload: dict) -> MatchAnalysis:
    jd = JDData.model_validate(payload["jd"])
    resume = ResumeData.model_validate(payload["resume"])
    resume_text = payload.get("resume_text") or "\n".join(resume.skills + [item.evidence for item in resume.education + resume.projects + resume.internships])
    features = tokenize(resume_text)
    known = set(resume.skills)
    matched = []
    gaps = []
    covered = 0
    total = 0
    for requirement in jd.requirements:
        weight = 2 if requirement.priority == "must" else 1
        total += weight
        topic_tokens = tokenize(requirement.topic)
        if requirement.topic in set(CONCEPT_ALIASES) | set(EXTRA_SKILLS):
            hit = requirement.topic in known
        else:
            hit = bool(topic_tokens and len(topic_tokens & features) / len(topic_tokens) >= 0.6)
        if hit:
            covered += weight
            evidence = next((line for line in lines_of(resume_text) if requirement.topic in skills_in(line) or requirement.topic.lower() in line.lower()), "简历技能字段：" + requirement.topic)
            matched.append(MatchPoint(requirement=requirement.topic, evidence=evidence[:1000], reason="简历出现对应概念；仅能说明文本覆盖，熟练程度仍需面试验证。"))
        else:
            gaps.append(f"{'必需' if requirement.priority == 'must' else '优先'}项「{requirement.topic}」缺少明确简历证据，不等于你不会。")
    suggestions = ["用真实项目的目标、本人职责、验证方法及局限补充证据，不添加未做过的经历。"]
    suggestions.extend("针对" + gap.split("」")[0].split("「")[-1] + "做基础知识复习或可验证练习，再更新材料。" for gap in gaps[:5])
    return MatchAnalysis(score=round(100 * covered / max(total, 1), 1), matched=matched, gaps=gaps,
                         suggestions=suggestions, summary="Mock 关键词证据覆盖度（不是录用概率）：必需项权重 2，优先项权重 1；不测量实际能力。")


def questions(payload: dict) -> QuestionSet:
    resume = ResumeData.model_validate(payload["resume"])
    jd = JDData.model_validate(payload["jd"])
    count = max(3, min(8, int(payload.get("question_count", 5))))
    topics = list(dict.fromkeys([item.topic for item in jd.requirements if item.topic in POINTS] + resume.skills + [item.topic for item in jd.requirements]))
    if not topics:
        topics = ["问题分析"]
    result = []
    for index in range(count):
        topic = topics[index % len(topics)][:150]
        level = ["基础", "项目", "进阶"][index % 3]
        points = POINTS.get(topic, [f"说明 {topic} 的输入、输出和用途", "交代方法适用条件与局限", "用可重复的验证方法评价结果"])
        evidence = next((item.evidence for item in jd.requirements if item.topic == topic), "简历技能：" + topic)
        if level == "基础":
            prompt = f"请解释 {topic} 的核心概念、适用场景和一个常见误区。" if index < 3 else f"围绕 {topic}，如何区分正确结果和看似正确的结果？请给一个边界条件。"
        elif level == "项目":
            project = resume.projects[min(index // 3, max(0, len(resume.projects) - 1))] if resume.projects else None
            subject = f"项目「{project.title}」" if project else "你实际参与过的一次课程或练习"
            prompt = f"以{subject}为例，说明目标、本人承担的部分、验证方法及局限。若没有应用过 {topic}，请明确说明，不要编造。"
            points = ["目标与本人职责边界", "真实的实施步骤和验证证据", "局限与改进思路"]
            if project:
                evidence = project.evidence[:1000]
        else:
            prompt = f"假设与 {topic} 相关的方案在新数据或环境下效果变差，你会如何排查、设计对照实验并判断改进有效？请区分设想和已完成工作。"
            points = ["复现问题并检查数据与环境", "控制变量和独立验证", "分场景分析误差及可用性边界"]
        result.append(Question(id=f"q{index + 1}", level=level, topic=topic, prompt=prompt, evidence=evidence[:1500], expected_points=points))
    return QuestionSet(questions=result)


def evaluate(payload: dict) -> Evaluation:
    question = Question.model_validate(payload["question"])
    answer = str(payload["answer"]).strip()
    tokens = tokenize(answer)
    hits = sum(bool(tokenize(point) & tokens) for point in question.expected_points)
    # This is an intentionally disclosed heuristic. A long answer alone never
    # yields high accuracy, and no factual truth assertion is produced.
    accuracy = min(4, round(4 * hits / max(1, len(question.expected_points))))
    structured = bool(re.search(r"首先|其次|最后|第一|第二|因此|因为|1[.、]|2[.、]|first|then|because", answer, re.I))
    logic = min(4, 1 + int(len(answer) >= 40) + int(structured) + int(len(answer) >= 120))
    specific = bool(re.search(r"验证|测试|对照|指标|数据|误差|test|measure|baseline", answer, re.I))
    limits = bool(re.search(r"没有|未参与|不熟悉|不确定|假设|局限|只负责|负责的|AI|辅助", answer, re.I))
    authenticity = min(3, 1 + int(specific) + int(limits))
    job_match = min(4, 1 + int(bool(tokenize(question.topic) & tokens)) + int(hits > 0) + int(specific))
    expression = min(4, 1 + int(len(answer) >= 30) + int(structured) + int(len(answer) >= 100))
    weak = accuracy < 3 or logic < 3
    improvements = []
    if accuracy < 3:
        improvements.append("补充当前问题的关键概念与依据：" + "；".join(question.expected_points))
    if not structured:
        improvements.append("按结论、理由、验证和局限组织回答。")
    if not limits:
        improvements.append("说明本人职责、借助工具的部分，以及尚未验证的假设。")
    strengths = []
    if structured:
        strengths.append("回答有明显的逻辑连接和分步结构。")
    if specific:
        strengths.append("提到了验证、数据或测试依据，可进一步补充细节。")
    if limits:
        strengths.append("出现职责或能力边界表述，有利于如实交流。")
    reference = "参考回答框架（不是可冒充个人经历的标准答案）：\n" + "\n".join(f"{i + 1}. {point}。" for i, point in enumerate(question.expected_points))
    reference += "\n结合实际材料说明你亲自做过的步骤与可验证证据；没有做过的部分请说‘我没有实践过，我的理解/验证计划是……’，不得添加虚构的职责、结果或数字。"
    return Evaluation(scores=Dimensions(accuracy=accuracy, logic=logic, authenticity=authenticity, job_match=job_match, expression=expression),
                      rationale=f"Mock 规则演示评分：检测到 {hits}/{len(question.expected_points)} 个要点的词语重合，并检查回答结构、验证及边界表述。它不理解全部语义，也不能判断技术事实或经历真伪；分数只用于演示流程。",
                      strengths=strengths, improvements=improvements, weak_topics=[question.topic] if weak else [],
                      reference_answer=reference, authenticity_note="真实性分仅为叙述具体性/边界表述的启发式指标，未进行事实核验；不能据此判定经历真实或虚假。",
                      needs_follow_up=weak and not payload.get("is_review", False),
                      follow_up=f"请就「{question.expected_points[0]}」补充一个具体解释和验证办法；未实际做过请明确说明。" if weak and not payload.get("is_review", False) else None)


class MockProvider:
    def generate(self, task: str, payload: dict, schema: type[Model]) -> Model:
        handlers = {"parse_resume": parse_resume, "parse_jd": parse_jd, "match": match_resume, "questions": questions, "evaluate": evaluate}
        if task not in handlers:
            from .providers import ProviderError
            raise ProviderError("unsupported_task", "不支持的演示任务")
        return schema.model_validate(handlers[task](payload).model_dump())
