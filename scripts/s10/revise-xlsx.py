#!/usr/bin/env python3
"""Make a scratch REVISION of an .xlsx by regex-substituting its shared strings (never touches the original).

    python3 -I scripts/s10/revise-xlsx.py SRC.xlsx DST.xlsx --sub 'REGEX=>REPLACEMENT' [--sub ...]

Used by the S10 revised-workbook check: change a date, swap a course, then run both versions through
scripts/s10/diff-revision.ts. DST must not be inside the repository (it holds real student data when SRC does).
No student data is embedded here; patterns are arguments.
"""
import re
import sys
import zipfile

src, dst = sys.argv[1], sys.argv[2]
subs = []
args = sys.argv[3:]
i = 0
while i < len(args):
    if args[i] == "--sub":
        pattern, repl = args[i + 1].split("=>", 1)
        subs.append((re.compile(pattern), repl.replace("\\n", "\n")))
        i += 2
    else:
        raise SystemExit(f"unknown argument {args[i]}")

total = 0
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename.endswith("sharedStrings.xml") or item.filename.startswith("xl/worksheets/sheet"):
            text = data.decode("utf-8")
            for rx, repl in subs:
                text, n = rx.subn(repl, text)
                total += n
                print(f"{item.filename} {rx.pattern!r}: {n} replacement(s)") if n else None
            data = text.encode("utf-8")
        zout.writestr(item, data)
print(f"total replacements: {total}")
