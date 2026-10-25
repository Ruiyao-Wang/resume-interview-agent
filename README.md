# resume-interview-agent

简历分析与模拟面试 Agent：支持简历解析、岗位匹配、多轮追问、回答评估、薄弱点复习与面试报告。基于 FastAPI、SQLite 和原生 JavaScript，提供无需 API Key 的演示模式及可替换的大模型接口。

在原有「求职表单助手」上扩展的 **FastAPI + SQLite + 原生 JavaScript** 全栈项目。保留素材库、项目版本推荐和浏览器辅助填表，新增从简历到复盘报告的有状态工作流。版本 **1.0.0**。

**默认 Mock 模式：无 API Key、无外部模型调用，能完整演示。** 真实模型接口可通过环境变量启用；本轮完成了模拟传输和故障测试，未声称验证真实模型评分质量。

## 功能

- 上传 PDF/DOCX，校验格式和大小，提取教育、技能、实习、项目等结构化信息，保留原文依据。
- 输入 JD，列出匹配点、缺口和准备建议。
- 生成基础、项目、进阶问题；逐题作答，每道主问题最多追问一次。
- 从准确性、逻辑、资料一致性、岗位匹配、表达五维反馈，给答题要点，不编造经历。
- 保存回答、评分、薄弱点与执行阶段；失败可重试、刷新可恢复历史。
- 错题独立复习，报告导出 JSON 或打印。
- 原个人资料、项目表述与简历附件不被覆盖。

匹配分不是录取概率；资料一致性不是背景调查；Mock 评分只演示流程，不代表实际能力。

## 架构与流程

~~~mermaid
flowchart LR
  UI[原生浏览器页面] --> API[FastAPI]
  API --> Extract[PDF/DOCX校验提取]
  API --> Workflow[Python状态机]
  Workflow --> Schema[Pydantic与证据校验]
  Schema --> Provider[可替换Provider]
  Provider --> Mock[本地规则演示]
  Provider --> LLM[OpenAI兼容模型服务]
  Workflow --> DB[(独立SQLite会话库)]
  Extension[原MV3扩展] --> Legacy[原素材API与数据库]
~~~

~~~mermaid
flowchart TD
  A[简历解析] --> B[JD解析] --> C[匹配分析] --> D[分层问题]
  D --> E[用户回答] --> F[五维评价] --> G[薄弱点记录]
  G --> H{需要追问?}
  H -- 有界追问 --> E
  H -- 下一题 --> E
  H -- 完成 --> I[最终报告] --> J[错题复习]
  F -.失败.-> K[保存失败节点和回答] --> L[重试]
  L --> F
~~~

详细架构、状态和边界见 [设计说明](docs/design.md)；初始问题和验收记录见 [项目审查](docs/project_audit.md)。

## 安装和启动

使用 **Python 3.11**。运行应用无需 Node.js；完整测试另需 **Node.js 20+** 和 Playwright。以下命令在包含本 README 的项目目录运行，不要在外层私人文档目录操作。

### Windows PowerShell

~~~powershell
python -m venv backend/.venv
backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock
Copy-Item .env.example .env
backend\.venv\Scripts\python.exe scripts/serve.py
~~~

已有 .env 时不要覆盖，按模板补充即可。也可双击「启动后台.bat」，首次缺依赖会安装。若8765被旧后台占用，关闭旧后台启动窗口，或运行：

~~~powershell
backend\.venv\Scripts\python.exe scripts/serve.py --port 8768
~~~

### macOS / Linux

~~~bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.lock
cp .env.example .env
backend/.venv/bin/python scripts/serve.py
~~~

打开 [面试 Agent](http://127.0.0.1:8765/interview)。[原素材库](http://127.0.0.1:8765/) 和 [Swagger接口文档](http://127.0.0.1:8765/docs) 均可使用。默认只监听本机，关闭进程即可停止。

## 3 分钟演示

1. 点击「使用脱敏示例，体验完整流程」，或上传自己的 PDF/DOCX。
2. 填写 JD，选择3题，点击「开始分析与面试」，查看结构化信息与匹配依据。
3. 首题回答“这个概念我还不太清楚”，观察评价、薄弱点和追问。
4. 继续如实作答；完成后生成报告，也可至少回答一题后主动结束。
5. 在错题复习区重新回答，刷新页面检查历史和报告。
6. 导出 JSON 或打印。删除会话前会要求确认。

虚构样本见 [resume.txt](examples/resume.txt) 和 [job_description.txt](examples/job_description.txt)。浏览器E2E另外生成真正的可提取文字PDF验证上传，不是只测示例按钮。

## 配置真实模型

在根目录 .env 中配置，不提交密钥：

~~~dotenv
AGENT_PROVIDER=openai_compatible
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=在本机填写你的密钥
LLM_MODEL=你有权限使用且支持结构化输出的模型名
LLM_TIMEOUT_SECONDS=30
LLM_MAX_RETRIES=2
LLM_RESPONSE_FORMAT=json_schema
~~~

重启服务，页面会标明模型模式，需先同意发送简历、JD和回答。网页不要求填写模型 API Key。使用兼容提供商时修改地址和模型名；需支持 /chat/completions、max_completion_tokens 和 JSON 输出。仅支持 JSON object 的服务可显式改 LLM_RESPONSE_FORMAT=json_object，仍执行 Pydantic 和证据校验。

鉴权错误不盲目重试，超时/结构错误有有限重试；失败**不会静默切换 Mock**。

| 环境变量 | 默认值 / 含义 |
| --- | --- |
| AGENT_PROVIDER | mock 或 openai_compatible |
| LLM_API_KEY / LLM_MODEL | 真实模式必填，Key只在后台 |
| LLM_BASE_URL | https://api.openai.com/v1，远端需HTTPS |
| LLM_TIMEOUT_SECONDS | 30，允许1–120秒 |
| LLM_MAX_RETRIES | 2次额外重试，允许0–3 |
| LLM_RESPONSE_FORMAT | json_schema 或 json_object |
| JOB_AUTOFILL_DATA_DIR | 默认项目 .data/ |
| APP_ACCESS_TOKEN | 本地可空，远端至少24字符随机口令 |
| APP_ALLOWED_HOSTS | 127.0.0.1,localhost,testserver |
| APP_ALLOWED_ORIGINS | 远端界面的完整HTTPS Origin，默认空 |

接口格式依据 [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)。Provider独立封装，可替换而不改前端和状态机。

## 测试：一条命令

首次安装测试依赖：

~~~bash
npm install
npx playwright install chromium
~~~

之后只需：

~~~bash
python scripts/check.py
~~~

包含 Python 单元/API/存储测试、Python AST静态检查、JavaScript语法检查、原扩展单元与E2E、下拉回归、面试浏览器全链路。任何失败返回非零状态，不把跳过当成功。

已有 Windows Edge 会自动选用；其他浏览器可设 TEST_BROWSER 为可执行文件绝对路径，Python环境可用 TEST_PYTHON 指定。npm test 等价于完整命令。仅快速测试可运行 python scripts/check.py --unit，该选项明确不包含浏览器验收。

测试不需要 Key，使用隔离数据库和8766/8767端口；端口占用会报错，不会关闭用户服务。浏览器测试输出合成数据截图路径。依赖可能输出 Starlette TestClient 关于 httpx 的弃用提醒，不影响当前测试，后续升级需验证客户端兼容性。

实际结果见 [验收记录](docs/project_audit.md)。

## 部署

提供 Dockerfile、Compose 和 GitHub Actions。

1. 复制 .env.example 为 .env，设置至少24字符随机 APP_ACCESS_TOKEN。可在本机运行 python -c "import secrets; print(secrets.token_urlsafe(32))" 生成。
2. 运行 docker compose up --build -d。
3. 打开本机8765端口 /interview，输入访问口令（不是模型Key）。
4. 数据持久化在 named volume。不要删除 volume，除非明确要销毁数据。

Compose默认只绑定主机127.0.0.1，非root运行、应用目录只读、带健康检查和资源限制。远程使用需额外配置TLS反向代理、13MiB请求大小限制、速率限制与Host/Origin白名单。

**单用户、单worker，不是多人SaaS。** 2026-10-25 已在 GitHub Actions 的 Linux 环境通过 Docker 构建与容器启动健康检查，以及完整回归测试，见[实际运行记录](https://github.com/Ruiyao-Wang/resume-interview-agent/actions/runs/40155671723)。这不等于已部署为公网服务；Compose、TLS反向代理和生产运维仍需在目标环境验证。

启用口令后所有私有新旧API均受保护。新Agent页面支持口令，旧扩展仍面向无口令localhost素材后台，尚无远端鉴权配置界面。

## 目录

~~~text
backend/
  app.py                    原API + Agent路由/鉴权/生命周期
  storage.py, matcher.py    保留的素材库与关键词推荐
  requirements.txt         直接依赖范围
  requirements.lock        本轮验证的精确Python依赖
  interview/
    schemas.py, config.py  数据契约与环境配置
    extraction.py          PDF/DOCX校验提取
    providers.py           模型接口、超时重试与输出校验
    mock_provider.py       明确标识的规则演示
    prompts.py             不编造经历的事实约束
    workflow.py            节点、追问、复习、报告
    store.py, routes.py    独立SQLite与HTTP接口
  dashboard/               原素材页面与interview.html/js/css
tests/                     原测试 + Agent单元/API/浏览器E2E
scripts/check.py            单命令验收
scripts/serve.py            本机启动
examples/                  虚构样本
docs/                      审查、设计、原扩展指南
manifest.json + *.js        保留的浏览器扩展
.env.example               无密钥模板
Dockerfile, compose.yaml   容器部署
~~~

## 数据与开源

- 原 autofill.sqlite3 和附件保留；新增 interview.sqlite3 保存解析文本、会话、回答和报告。
- 本地文件未加密，请在可信电脑使用；真实模型会外发文本，上传前自行脱敏。
- .gitignore/.dockerignore 排除 .env、.data、私人文档、日志和虚拟环境。GitHub网页上传不自动遵守忽略规则，建议用 pack-release.ps1 的源码白名单包。
- 开源仅发布经过检查的白名单源码；本地简历、个人资料、数据库和密钥不进入版本库。
- 扩展安装与操作见 [原扩展指南](docs/extension-guide.md)，最终提交始终由用户完成。
- MIT License；反馈问题时仅附脱敏资料。

## 可如实写进简历的项目描述

**简历分析与模拟面试 Agent｜Python / FastAPI / Pydantic / SQLite / JavaScript**

- 在既有求职素材库上实现简历解析、JD匹配、分层问题、多轮追问、五维反馈、薄弱点复习及报告，使用显式状态机持久化节点与回答。
- 封装可替换模型接口，加入超时、有限重试、结构化输出和原文证据校验；提供无需密钥的Mock演示，不将课程项目包装为实习。
- 增加上传校验、幂等提交、并发保护、失败恢复及单命令测试，保留原扩展回归；提供容器部署配置和脱敏数据。

只写你实际理解并能解释的部分；不要把AI辅助实现说成全部独立手写，也不要虚构用户量、线上规模、性能提升或模型准确率。

## 真实限制

没有OCR、语音面试、互联网事实核查、多人账户或分布式队列；复杂排版可能误提取，规则模式理解能力有限；模型建议与评分必须核对。真实模型调用仍未实测；Docker构建及基础运行已通过云端CI，但不代表完成生产部署。其他边界和后续优化见 [设计说明](docs/design.md)。
