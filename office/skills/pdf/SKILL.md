---
name: pdf
metadata:
  display-name: PDF
description: Read, generate, render and edit PDF documents, merge/split/rotate pages and fill form fields.
---

# Pdf

## Execution

Use the existing `run_command` tool on the execution Node to inspect available interpreters and required libraries before running a script saved in the current worktree. Sailry does not bundle Python or document libraries. Reuse a suitable project environment; install missing task dependencies only when needed, in a project-local virtual environment and under the session's command permissions. Do not install globally or change the application's files. If an interpreter, network access or permission is unavailable, report what is missing instead of claiming the task succeeded. Loading this skill does not itself install anything. Quote executable and file paths, and inspect library APIs with `help()` or `inspect` when needed.

Native `read_office` and `export_pdf` provide inspection and PDF conversion. Author and edit with the script libraries. Scripts use the existing command tool's permissions and working directory. If command execution is disabled or denied, report that constraint without bypassing it.

For existing files, inspect the original and preserve unrelated content. For focused script edits, record the source hash, load the existing file, save to a sibling temporary file, reopen and validate it, recheck the source hash immediately before replacement, then use `os.replace`. Preserve the original and report a conflict if its hash changed. Do not rebuild an existing file from extracted plain text. A library may drop unsupported package parts: inspect those parts and use a focused ZIP/XML patch when necessary. Keep relationships, namespaces and content types consistent.

Before any save, create the destination directory with `Path(destination).parent.mkdir(parents=True, exist_ok=True)`. This applies to documents, images, exports, and temporary output files. Verify saved content and the requested changes. Use `export_pdf` for Office print previews, or the PDF libraries for PDF inspection/rendering. Conversion warnings are real limitations; successful export alone does not prove visual fidelity. Use the available image viewing tool to inspect representative rendered pages when layout matters. Keep editable source files. Return deliverables as ordinary standalone Markdown links, for example `[Report](output/report.docx)`. Sailry provides cards and side-panel previews; do not fabricate output paths or JSON cards.

## PDF authoring

Use `reportlab` to generate PDFs with precise layout and fonts, `pypdf` for page operations, metadata and forms, `pdfplumber` for text/table extraction, and `pypdfium2` for page rendering. Prepare only the libraries needed for the task in the selected project environment. Keep the editable Word/Excel/PPT source when text must reflow; regenerate its PDF after changes.

```python
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader
import pypdfium2 as pdfium
c = canvas.Canvas('report.pdf', pagesize=A4)
c.setFont('Helvetica', 18)
c.drawString(54, 780, 'Report')
c.save()
assert len(PdfReader('report.pdf').pages) == 1
pdf = pdfium.PdfDocument('report.pdf')
pdf[0].render(scale=1.5).to_pil().save('report-page-1.png')
```

Register an available Unicode font for multilingual documents; base PDF fonts do not cover arbitrary text. Inspect actual form field names/types before filling and reopen the saved values. A white rectangle or deleted extracted text is not secure redaction. These libraries are not OCR engines; scanned pages require a separate available OCR capability. Do not claim an empty extraction means a blank page. Verify page order/rotation, fonts, form values and rendered layout before delivering.

## Package resources

- `templates/create.py` is an editable starter script, not a restricted authoring API. Read it with `read_skill_resource`, copy it into the worktree, then adapt its full library calls to the user's document. Run it with the selected project interpreter and an output path. It creates missing parent directories and refuses to replace an existing file.
- `scripts/inspect_file.py` prints the saved file's content for verification. Run `<python> <skill-directory>/scripts/inspect_file.py <file>` using the absolute directory returned by `load_skill`. Quote paths and keep package resources unchanged. Structural inspection alone does not prove layout fidelity.

The plugin contains instructions, scripts and templates, not an interpreter. `read_office` and `export_pdf` are supplied by Sailry's Files capability; `run_command` uses Commands on the execution Node. If a required capability is unavailable, explain what must be enabled. Installing or enabling this skill does not grant execution permission.
