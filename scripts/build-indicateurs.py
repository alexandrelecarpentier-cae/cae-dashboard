#!/usr/bin/env python3
"""Génère public/indicateurs.html à partir de NOTE-INDICATEURS.md.
Usage : python3 scripts/build-indicateurs.py   (à relancer après toute modif de la note)"""
import re, json, html, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
md = (root / 'NOTE-INDICATEURS.md').read_text(encoding='utf-8')

def inline(t):
    t = html.escape(t.strip(), quote=False)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    return t

def section(title):
    m = re.search(r'^## ' + re.escape(title) + r'.*?\n(.*?)(?=^## |\Z)', md, re.S | re.M)
    return m.group(1).strip() if m else ''

def bullets(txt):
    return [inline(l[2:]) for l in txt.splitlines() if l.startswith('- ')]

rows = []
for l in section('Indicateurs').splitlines():
    if not l.startswith('|') or l.startswith('|---') or l.startswith('| Indicateur'):
        continue
    c = [x.strip() for x in l.strip().strip('|').split(' | ')]
    if len(c) >= 3:
        rows.append({'n': re.sub(r'\*\*', '', c[0]), 'd': inline(c[1]), 'p': [x.strip().strip('`') for x in re.split(r',\s*', re.sub(r'\*\*', '', c[2])) if x.strip()], 'raw': c[2]})

data = {'indicateurs': [{'n': r['n'], 'd': r['d'], 'p': inline(r['raw'])} for r in rows]}

# formules, tables/variables, formats, exemples
det = json.load(open(root / 'scripts' / 'indicateurs-details.json', encoding='utf-8'))
names = [i['n'] for i in data['indicateurs']]
missing = [n for n in names if n not in det]
extra = [n for n in det if n not in names]
if missing or extra: print('ATTENTION détails manquants:', missing, 'inconnus:', extra)

# infobulles de /anne (label -> texte)
tipmap = {}
for l in open(root / 'public' / 'anne.html', encoding='utf-8'):
    for m in re.finditer(r"c\('([^']+)',[^;]*?,'([^']+)'\)", l):
        tipmap.setdefault(m.group(1), m.group(2))
e = lambda t: html.escape(t, quote=False)
for i in data['indicateurs']:
    d = det.get(i['n'], {})
    i['f'] = e(d.get('f', '')); i['e'] = e(d.get('e', '')); i['v'] = e(d.get('v', '')); i['fmt'] = e(d.get('fmt', ''))
    tt = []
    for lab in [x.strip() for x in d.get('tt', '').split(';') if x.strip() and not x.strip().startswith('—')]:
        if lab in tipmap: tt.append({'l': e(lab), 't': e(tipmap[lab])})
        else: print('infobulle introuvable:', lab, '(', i['n'], ')')
    i['tt'] = tt

page = open(root / 'scripts' / 'indicateurs.template.html', encoding='utf-8').read()
out = page.replace('/*__DATA__*/null', json.dumps(data, ensure_ascii=False))
(root / 'public' / 'indicateurs.html').write_text(out, encoding='utf-8')
print(len(rows), 'indicateurs,', len(tipmap), 'infobulles')
