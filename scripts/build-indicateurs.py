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

data = {
    'indicateurs': [{'n': r['n'], 'd': r['d'], 'p': inline(r['raw'])} for r in rows],
    'regles': bullets(section('Règles communes')),
    'formats': inline(section("Formats d'affichage")),
    'reserves': bullets(section('Réserves connues')),
    'anne': inline(section('Dashboard /anne')),
}

# formules + exemples
det = json.load(open(root / 'scripts' / 'indicateurs-details.json', encoding='utf-8'))
names = [i['n'] for i in data['indicateurs']]
missing = [n for n in names if n not in det]
extra = [n for n in det if n not in names]
if missing or extra: print('ATTENTION détails manquants:', missing, 'inconnus:', extra)
for i in data['indicateurs']:
    d = det.get(i['n'])
    if d: i['f'] = html.escape(d['f'], quote=False); i['e'] = html.escape(d['e'], quote=False)

# infobulles de /anne
tips, seen = [], set()
for l in open(root / 'public' / 'anne.html', encoding='utf-8'):
    m = re.match(r"\s*c\('([^']+)',.*,'([^']+)'\),?\s*$", l)
    if m and (m.group(1), m.group(2)) not in seen:
        seen.add((m.group(1), m.group(2)))
        tips.append({'l': html.escape(m.group(1), quote=False), 't': html.escape(m.group(2), quote=False)})
data['tips'] = tips

page = open(root / 'scripts' / 'indicateurs.template.html', encoding='utf-8').read()
out = page.replace('/*__DATA__*/null', json.dumps(data, ensure_ascii=False))
(root / 'public' / 'indicateurs.html').write_text(out, encoding='utf-8')
print(len(rows), 'indicateurs,', len(tips), 'infobulles')
