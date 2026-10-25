from __future__ import annotations

import io
import logging
import sys
import unittest
import zipfile
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.interview.extraction import ExtractionError, extract_text, MAX_FILE_BYTES, MAX_MEMBER_BYTES


def make_docx(text="示例大学 Python 项目经历", extras=None, xml=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr("word/document.xml", xml or '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:body></w:document>')
        for filename, value in (extras or {}).items():
            archive.writestr(filename, value)
    return output.getvalue()


def make_pdf(text="Example resume Python project", pages=1, encrypted=False):
    writer = PdfWriter()
    for _ in range(pages):
        page = writer.add_blank_page(width=612, height=792)
        if text:
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
            stream = DecodedStreamObject()
            stream.set_data(f"BT /F1 12 Tf 20 700 Td ({text}) Tj ET".encode("ascii"))
            page[NameObject("/Contents")] = writer._add_object(stream)
    if encrypted:
        writer.encrypt("test-only")
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


class ExtractionTests(unittest.TestCase):
    def assert_error(self, filename, content, code, allow_text=False):
        with self.assertRaises(ExtractionError) as caught:
            extract_text(filename, content, allow_text=allow_text)
        self.assertEqual(caught.exception.status_code, code)
        self.assertTrue(caught.exception.message)

    def test_docx_and_pdf(self):
        self.assertIn("Python", extract_text("resume.DOCX", make_docx()))
        self.assertIn("Python", extract_text("resume.pdf", make_pdf()))

    def test_legacy_text_is_opt_in_and_utf8(self):
        self.assertEqual(extract_text("resume.md", "测试 Python".encode(), allow_text=True), "测试 Python")
        self.assert_error("resume.txt", b"resume", 415)
        self.assert_error("resume.txt", b"\xff\xfe", 422, True)

    def test_size_type_and_signature(self):
        self.assert_error("resume.pdf", b"", 422)
        self.assert_error("resume.docx", b"x" * (MAX_FILE_BYTES + 1), 413)
        self.assert_error("resume.exe", b"not a resume", 415)
        self.assert_error("resume.pdf", make_docx(), 422)
        self.assert_error("resume.docx", b"not a zip", 422)
        self.assert_error("resume.pdf", b"%PDF-1.4 corrupt", 422)

    def test_blank_scan_and_encryption(self):
        self.assert_error("scan.pdf", make_pdf(text=""), 422)
        self.assert_error("locked.pdf", make_pdf(encrypted=True), 422)
        self.assert_error("blank.docx", make_docx(text=" "), 422)

    def test_limits(self):
        self.assert_error("huge.pdf", make_pdf(text="", pages=81), 413)
        self.assert_error("huge.docx", make_docx(text="x" * 60001), 413)
        self.assert_error("bomb.docx", make_docx(extras={"word/media/image.png": b"0" * (MAX_MEMBER_BYTES + 1)}), 413)

    def test_zip_paths_macros_and_entities(self):
        self.assert_error("resume.docx", make_docx(extras={"../outside.txt": "unsafe"}), 422)
        self.assert_error("resume.docx", make_docx(extras={"word/vbaProject.bin": "unsafe"}), 422)
        xml = '<!DOCTYPE test [<!ENTITY xxe SYSTEM "file:///private">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:t>&xxe;</w:t></w:p></w:document>'
        self.assert_error("resume.docx", make_docx(xml=xml), 422)

    def test_pdf_warning_does_not_log_document_payload(self):
        with self.assertLogs("interview.extraction", level="WARNING") as logs:
            logging.getLogger("pypdf._reader").warning("malformed object: private resume content 12345")
        self.assertIn("pdf_structure_warning", "".join(logs.output))
        self.assertNotIn("private resume", "".join(logs.output))


if __name__ == "__main__":
    unittest.main()
