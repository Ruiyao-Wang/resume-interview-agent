"""Bounded text extraction. Files are read in memory, never executed or unpacked."""
from __future__ import annotations

import io
import json
import logging
import re
import zipfile
from pathlib import PurePosixPath
from xml.etree import ElementTree

from pypdf import PdfReader
from pypdf.errors import PdfReadError

MAX_FILE_BYTES = 12 * 1024 * 1024
MAX_TEXT_CHARS = 60000
MAX_PDF_PAGES = 80
MAX_ZIP_BYTES = 40 * 1024 * 1024
MAX_MEMBER_BYTES = 8 * 1024 * 1024


class _SafePDFLogHandler(logging.Handler):
    """PDF warnings can contain object data. Re-emit metadata, never the payload."""
    def emit(self, record):
        logging.getLogger("interview.extraction").log(record.levelno, json.dumps({
            "event": "pdf_parser_warning", "code": "pdf_structure_warning", "level": record.levelname,
        }))


_pdf_logger = logging.getLogger("pypdf")
_pdf_logger.propagate = False
if not any(handler.get_name() == "safe_interview_pdf_log" for handler in _pdf_logger.handlers):
    _safe_handler = _SafePDFLogHandler()
    _safe_handler.set_name("safe_interview_pdf_log")
    _pdf_logger.addHandler(_safe_handler)


class ExtractionError(ValueError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _xml(data: bytes):
    # ElementTree does not resolve external entities. Explicitly reject declarations
    # too, including UTF-16 documents, so internal entity expansion is not accepted.
    compact = data.replace(b"\x00", b"").upper()
    if b"<!DOCTYPE" in compact or b"<!ENTITY" in compact:
        raise ExtractionError(422, "DOCX 包含不支持的 XML 实体声明")
    return ElementTree.fromstring(data)


def _docx(content: bytes) -> str:
    if not content.startswith(b"PK\x03\x04"):
        raise ExtractionError(422, "文件内容与 DOCX 格式不符")
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            members = archive.infolist()
            if len(members) > 500 or sum(item.file_size for item in members) > MAX_ZIP_BYTES:
                raise ExtractionError(413, "DOCX 解压后内容过大或文件数量过多")
            names = set()
            for item in members:
                path = PurePosixPath(item.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts or ":" in item.filename or item.filename in names:
                    raise ExtractionError(422, "DOCX 包含不安全或重复的文件路径")
                names.add(item.filename)
                if item.file_size > MAX_MEMBER_BYTES or item.flag_bits & 1:
                    raise ExtractionError(413, "DOCX 内部文件过大或已加密")
                if re.search(r"vba|macros|\.exe$|\.dll$|\.js$", item.filename, re.I):
                    raise ExtractionError(422, "不接受包含宏或可执行内容的 DOCX")
            if not {"[Content_Types].xml", "word/document.xml"}.issubset(names):
                raise ExtractionError(422, "DOCX 缺少必要的文档结构")
            types = archive.read("[Content_Types].xml")
            type_root = _xml(types)
            content_types = [node.attrib.get("ContentType", "") for node in type_root]
            if any("macroenabled" in value.lower() or "vba" in value.lower() for value in content_types):
                raise ExtractionError(422, "不接受宏启用文档")
            if "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" not in content_types:
                raise ExtractionError(422, "压缩包不是标准 DOCX 文档")
            root = _xml(archive.read("word/document.xml"))
            namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
            paragraphs = []
            for paragraph in root.iter(namespace + "p"):
                paragraphs.append("".join(node.text or "" for node in paragraph.iter(namespace + "t")))
            return "\n".join(paragraphs)
    except ExtractionError:
        raise
    except (zipfile.BadZipFile, zipfile.LargeZipFile, ElementTree.ParseError, KeyError, RuntimeError, NotImplementedError, OSError, ValueError) as error:
        raise ExtractionError(422, "DOCX 已损坏或使用不支持的压缩/文档格式") from error


def _pdf(content: bytes) -> str:
    if not content.startswith(b"%PDF-"):
        raise ExtractionError(422, "文件内容与 PDF 格式不符")
    try:
        reader = PdfReader(io.BytesIO(content), strict=True)
        if reader.is_encrypted:
            raise ExtractionError(422, "请先移除 PDF 密码后上传")
        if len(reader.pages) > MAX_PDF_PAGES:
            raise ExtractionError(413, f"PDF 不能超过 {MAX_PDF_PAGES} 页")
        parts = []
        length = 0
        for page in reader.pages:
            text = page.extract_text() or ""
            length += len(text)
            if length > MAX_TEXT_CHARS:
                raise ExtractionError(413, f"简历文本不能超过 {MAX_TEXT_CHARS} 字符")
            parts.append(text)
        return "\n".join(parts)
    except ExtractionError:
        raise
    except (PdfReadError, ValueError, TypeError, KeyError, IndexError, OSError, RecursionError, NotImplementedError) as error:
        raise ExtractionError(422, "PDF 无法解析，请重新导出为可复制文字的 PDF") from error


def extract_text(filename: str, content: bytes, allow_text: bool = False) -> str:
    if not content:
        raise ExtractionError(422, "上传文件不能为空")
    if len(content) > MAX_FILE_BYTES:
        raise ExtractionError(413, "文件不能超过 12 MB")
    suffix = PurePosixPath(filename.replace("\\", "/")).suffix.lower()
    if suffix == ".pdf":
        text = _pdf(content)
    elif suffix == ".docx":
        text = _docx(content)
    elif suffix in {".txt", ".md"} and allow_text:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ExtractionError(422, "文本文件需使用 UTF-8 编码") from error
    else:
        formats = "PDF、DOCX、TXT 或 MD" if allow_text else "PDF 或 DOCX"
        raise ExtractionError(415, f"请上传 {formats} 格式文件")
    text = text.replace("\x00", "").strip()
    if not text or not re.search(r"[\w\u4e00-\u9fff]", text):
        raise ExtractionError(422, "未提取到可用文字；扫描件请先进行 OCR 或改用 DOCX")
    if len(text) > MAX_TEXT_CHARS:
        raise ExtractionError(413, f"简历文本不能超过 {MAX_TEXT_CHARS} 字符")
    return text
