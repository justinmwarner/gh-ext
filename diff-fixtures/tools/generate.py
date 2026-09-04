# -*- coding: utf-8 -*-
"""Every non-image fixture, in both of the states a pull request compares.

One script rather than two files per fixture, so the pair cannot drift: each
entry says what it is there to exercise, and its `after` value sits beside its
`before` one.

Not committed. It exists to build the branches, not to live in them.
"""
import io
import json
import os
import sys
import zipfile

variant = sys.argv[1]
root = sys.argv[2]
A = variant == 'after'


def w(rel, text, newline='\n', trailing=True):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if trailing and not text.endswith('\n'):
        text += '\n'
    with open(p, 'wb') as f:
        f.write(text.replace('\n', newline).encode('utf-8'))


def wb(rel, data):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'wb') as f:
        f.write(data)


def rm(rel):
    p = os.path.join(root, rel)
    if os.path.exists(p):
        os.remove(p)


TAB = '\t'

# ------------------------------------------------------------------ vector

SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" width="240" height="140">
  <rect width="240" height="140" fill="#ffffff"/>
  <g fill="{colour}">
    <rect x="20"  y="{y1}" width="30" height="{h1}"/>
    <rect x="60"  y="{y2}" width="30" height="{h2}"/>
    <rect x="100" y="{y3}" width="30" height="{h3}"/>
    <rect x="140" y="60" width="30" height="60"/>
  </g>
  <text x="20" y="136" font-family="sans-serif" font-size="10">{label}</text>
</svg>'''

# Rendered, the bars move and change colour. As source, it is a handful of
# changed attributes. Both readings are useful and they are not the same.
w('vector/chart.svg', SVG.format(
    colour='#1f883d' if A else '#0969da',
    y1=30 if A else 70, h1=90 if A else 50,
    y2=55 if A else 40, h2=65 if A else 80,
    y3=20 if A else 85, h3=100 if A else 35,
    label='after: q3 revised' if A else 'before: q3 draft',
))

if A:
    w('vector/icon-tiny.svg', '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <path fill="currentColor" d="M8 1.5 10 6l4.5.5-3.4 3 1 4.5L8 11.7 3.9 14l1-4.5-3.4-3L6 6Z"/>
</svg>''')

# -------------------------------------------------------------------- data

# One cell changed, one row added, one row removed.
w('data/people.csv', '''id,name,role,city,started
1,Ada Lovelace,Engineer,London,2019-04-01
2,Grace Hopper,{role},New York,2020-07-15
3,Alan Turing,Researcher,Cambridge,2018-01-09
{liskov}5,Katherine Johnson,Analyst,Hampton,2022-11-30'''.format(
    role='Director' if A else 'Engineer',
    liskov='' if A else '4,Barbara Liskov,Architect,Boston,2021-03-22\n',
))

# The same rows with the columns in a different order. A line-wise diff calls
# every line changed; a column-aware one should say the data did not move.
w('data/reordered.csv', '''name,id,city,role
Ada Lovelace,1,London,Engineer
Grace Hopper,2,New York,Engineer
Alan Turing,3,Cambridge,Researcher''' if A else '''id,name,role,city
1,Ada Lovelace,Engineer,London
2,Grace Hopper,Engineer,New York
3,Alan Turing,Researcher,Cambridge''')

# Wide enough to need horizontal scrolling, and tab separated rather than comma.
cols = TAB.join('col_%02d' % i for i in range(1, 25))
rows = []
for r in range(1, 6):
    cells = []
    for c in range(1, 25):
        mark = '!' if (A and r == 2 and c == 7) else ''
        cells.append('r%dc%d%s' % (r, c, mark))
    rows.append(TAB.join(cells))
w('data/wide.tsv', cols + '\n' + '\n'.join(rows))

# Four thousand rows. Any cell-by-cell renderer has to decide what it does here
# before a reviewer opens it, not while they wait.
big = ['id,ts,level,service,message,latency_ms']
for i in range(1, 4001):
    level = 'ERROR' if i % 500 == 0 else ('WARN' if i % 97 == 0 else 'INFO')
    latency = (i * 7) % 900 + (5 if A and i % 3 == 0 else 0)
    big.append('%d,2026-09-0%dT10:%02d:%02dZ,%s,api-%d,request handled,%d'
               % (i, (i % 8) + 1, i % 60, (i * 13) % 60, level, i % 12, latency))
w('data/big.csv', '\n'.join(big))

# A value changed three levels down, a key added, a key removed, an array
# extended. None of which a line diff describes as what it is.
config = {
    'name': 'gh-ext',
    'version': '2.1.0' if A else '2.0.4',
    'server': {
        'host': '0.0.0.0',
        'port': 8080,
        'tls': {'enabled': True, 'minVersion': '1.3' if A else '1.2'},
        'timeouts': dict(
            [('readMs', 5000), ('writeMs', 5000)] + ([('idleMs', 30000)] if A else [])
        ),
    },
    'features': ['diffs', 'threads', 'checks'] + (['commits'] if A else []),
    'logging': {'level': 'debug' if A else 'info', 'sinks': ['stdout']},
}
if not A:
    config['deprecated'] = {'legacyApi': True}
w('data/config.json', json.dumps(config, indent=2))

# Identical content, different key order. Structurally nothing changed at all;
# a text diff reports the entire file.
pairs = [('alpha', 1), ('beta', 2), ('gamma', 3), ('delta', 4), ('epsilon', 5)]
w('data/reordered.json', json.dumps(dict(reversed(pairs)) if A else dict(pairs), indent=2))

# An element inserted in the middle, which shifts every index after it.
items = [{'sku': 'A-%03d' % i, 'qty': i * 2} for i in range(1, 6)]
if A:
    items.insert(2, {'sku': 'A-999', 'qty': 99})
w('data/array.json', json.dumps({'items': items}, indent=2))

# A lockfile: long, generated, and not worth a reviewer's attention.
deps = {}
for i in range(1, 61):
    bumped = A and i % 7 == 0
    deps['node_modules/pkg-%02d' % i] = {
        'version': '1.%d.%d' % (i, 3 if bumped else 0),
        'resolved': 'https://registry.npmjs.org/pkg-%02d/-/pkg-%02d-1.%d.0.tgz' % (i, i, i),
        'integrity': 'sha512-' + ('b' if bumped else 'a') * 60 + '==',
    }
w('data/package-lock.json',
  json.dumps({'name': 'fixtures', 'lockfileVersion': 3, 'packages': deps}, indent=2))

# --------------------------------------------------------------- notebooks


def cell(kind, src, outputs=None):
    c = {'cell_type': kind, 'metadata': {}, 'source': src}
    if kind == 'code':
        c['execution_count'] = 1
        c['outputs'] = outputs or []
    return c


nb_cells = [
    cell('markdown', ['# Latency analysis\n', '\n',
                      'Revised after the September rollout.\n' if A else 'First pass.\n']),
    cell('code',
         ['import pandas as pd\n', "df = pd.read_csv('big.csv')\n"]
         + (["df = df[df.level != 'INFO']\n"] if A else [])
         + ['df.describe()\n'],
         [{'output_type': 'stream', 'name': 'stdout',
           'text': ['count  1200\n' if A else 'count  4000\n', 'mean    452.1\n']}]),
    cell('code', ['df.groupby("service").latency_ms.mean().plot()\n'],
         [{'output_type': 'display_data', 'data': {'text/plain': ['<Axes: >']}, 'metadata': {}}]),
]
if A:
    nb_cells.append(cell('markdown', ['## Conclusion\n', '\n', 'p99 is the problem, not the mean.\n']))
w('notebooks/analysis.ipynb', json.dumps({
    'cells': nb_cells,
    'metadata': {'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'}},
    'nbformat': 4,
    'nbformat_minor': 5,
}, indent=1))

# -------------------------------------------------------------------- docs

w('docs/guide.md', '''# Reviewing a pull request

{intro}

## Getting started

1. Open the pull request on GitHub.
2. Press the review button in the corner.
3. Read the diff.

> Markdown is drawn as plain text in the review page today.

```ts
const review = await open(pullRequest);
review.submit({{ event: {event} }});
```

See [the design](../README.md) for the reasoning.
'''.format(
    intro=('This guide covers the review page, the commit picker and the rich diff modes.'
           if A else 'This guide covers the review page.'),
    event="'APPROVE'" if A else "'COMMENT'",
))

w('docs/table.md', '''# Supported types

| Type | Smart mode | Raw fallback |
| --- | --- | --- |
| PNG, JPEG, GIF | side-by-side, onion, swipe{extra} | yes |
| SVG | rendered, source | yes |
| CSV | column aware | yes |
| JSON | structural | yes |
{notebook}'''.format(
    extra=', difference' if A else '',
    notebook='| Notebook | cell aware | yes |\n' if A else '',
))

# --------------------------------------------------------------- generated

w('generated/schema.generated.js', '''// Code generated by schema-gen. DO NOT EDIT.
/* eslint-disable */
export const Schema = {{
  version: {version},
  tables: {{
    users: {{ id: 'uuid', email: 'text', created_at: 'timestamptz'{soft} }},
    posts: {{ id: 'uuid', author: 'uuid', body: 'text' }},
  }},
}};
'''.format(version=7 if A else 6, soft=", deleted_at: 'timestamptz'" if A else ''))

w('generated/api.pb.go', '''// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
{t}// protoc-gen-go v1.{version}.0

package api

type Review struct {{
{t}Id    string `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
{t}State string `protobuf:"bytes,2,opt,name=state,proto3" json:"state,omitempty"`
{commit}}}
'''.format(
    t=TAB,
    version=34 if A else 33,
    commit=(TAB + 'Commit string `protobuf:"bytes,3,opt,name=commit,proto3" json:"commit,omitempty"`\n') if A else '',
))

# ------------------------------------------------------------------- edges

if A:
    # Added, and completely empty. There is no diff to draw.
    w('edges/empty.txt', '', trailing=False)

# No trailing newline on either side, which git reports specially.
w('edges/no-newline.txt',
  'This file deliberately ends without a newline.\nSecond line%s' % (' (edited)' if A else ''),
  trailing=False)

# Every line ends CRLF. A renderer that does not strip them shows stray glyphs.
w('edges/crlf.txt',
  'Carriage returns and line feeds.\nEvery line here ends CRLF.\n'
  + ('A third line, also CRLF.\n' if A else ''),
  newline='\r\n')

# Emoji with zero-width joiners, combining marks, right-to-left runs, and CJK.
# Anything that counts characters as bytes gets these wrong.
w('edges/unicode.txt', '''Emoji: \U0001F469‍\U0001F4BB \U0001F9D1\U0001F3FD‍\U0001F680 \U0001F1EC\U0001F1E7 {mood}
Combining: é vs é — same word, different bytes
RTL: العربية and עברית inside a left-to-right line
CJK: 日本語のテキスト、中文文本、한국어
Tabs{t}and{t}alignment'''.format(mood='\U0001F680' if A else '\U0001F41B', t=TAB))

# One line of twelve thousand characters, to see what wrapping does.
w('edges/long-lines.txt',
  'A short line.\n' + ('x' * 12000) + ('y' if A else '') + '\nAnother short line.')

# A whitespace-only change: tabs against spaces, nothing else.
w('edges/whitespace.py', '''def compute(values):
{indent}# indentation changes on this line and nothing else does
    total = 0
    for value in values:
        total += value
    return total
'''.format(indent=TAB if A else '    '))

# Renamed and edited in the same change, which git may or may not detect
# depending on how much survived.
w('edges/renamed-edited%s.txt' % ('-new' if A else ''),
  'This file is renamed between the two sides%s.\n'
  % (' and edited in the same commit' if A else ''))
if A:
    rm('edges/renamed-edited.txt')

# Renamed with the content untouched: a pure rename, 100% similarity.
w('edges/renamed-to.txt' if A else 'edges/renamed-from.txt',
  'Renamed with no content change at all.\n')
if A:
    rm('edges/renamed-from.txt')

if not A:
    w('edges/deleted.txt',
      'This file exists on the base side only.\nThe pull request removes it.\n')
else:
    rm('edges/deleted.txt')

w('edges/permissions.sh', '''#!/usr/bin/env bash
set -euo pipefail
echo "the file mode changes between the two sides"{extra}
'''.format(extra='\necho "and so does the body"' if A else ''))

# -------------------------------------------------------------------- code

w('code/app.js', '''export function summarize(files) {{
  const total = files.reduce((sum, file) => sum + file.additions{plus}, 0);
  return `${{files.length}} files, +${{total}}`;
}}

export const NOISE = [/\\.lock$/, /^dist\\//{extra}];
'''.format(plus=' + file.deletions' if A else '',
           extra=', /\\.generated\\./' if A else ''))

w('code/server.py', '''from dataclasses import dataclass


@dataclass
class Review:
    id: str
    state: str
{commit}

def submit(review: Review) -> bool:
    if review.state == "PENDING":
        return False
    return True
'''.format(commit='    commit: str | None = None\n' if A else ''))

w('code/main.go', '''package main

import "fmt"

type Review struct {{
{t}ID    string
{t}State string
{commit}}}

func main() {{
{t}fmt.Println("review", Review{{ID: "1", State: "{state}"}})
}}
'''.format(t=TAB,
           commit=(TAB + 'Commit string\n') if A else '',
           state='APPROVED' if A else 'PENDING'))

# ------------------------------------------------------------------ binary

# A small but genuinely valid one-page PDF, so a viewer that tries to render it
# gets something real rather than noise.
objects = [
    b'1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    b'2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    b'3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] '
    b'/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    b'4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
]
stream = b'BT /F1 18 Tf 20 60 Td (' + (b'after' if A else b'before') + b') Tj ET'
objects.append(b'5 0 obj\n<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n'
               + stream + b'\nendstream\nendobj\n')

pdf = io.BytesIO()
pdf.write(b'%PDF-1.4\n')
offsets = []
for obj in objects:
    offsets.append(pdf.tell())
    pdf.write(obj)
xref = pdf.tell()
pdf.write(b'xref\n0 %d\n' % (len(objects) + 1))
pdf.write(b'0000000000 65535 f \n')
for off in offsets:
    pdf.write(b'%010d 00000 n \n' % off)
pdf.write(b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n'
          % (len(objects) + 1, xref))
wb('binary/report.pdf', pdf.getvalue())

# A real archive, so the bytes are structured rather than random.
zbuf = io.BytesIO()
with zipfile.ZipFile(zbuf, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('readme.txt', 'archive contents, %s side\n' % variant)
    z.writestr('data/values.csv', 'a,b\n1,%d\n' % (2 if A else 1))
wb('binary/archive.zip', zbuf.getvalue())

if A:
    # Not a real font, deliberately. What matters is that the extension sees
    # wOF2, calls it binary, and does not try to render it.
    wb('binary/font.woff2', b'wOF2' + bytes(range(256)) * 3)

print('wrote', variant)
