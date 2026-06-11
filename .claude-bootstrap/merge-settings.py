#!/usr/bin/env python3
"""Merge the GSD settings fragment into ~/.claude/settings.json.

Substitutes __NODE__ / __CLAUDE_DIR__ placeholders for this machine, then
merges hook groups per event (deduped by command string) and sets statusLine
only if absent. Idempotent — safe to re-run.
"""
import json, os, shutil, sys

frag_path, dest_path = sys.argv[1], sys.argv[2]

node = shutil.which('node') or '/opt/node22/bin/node'
claude_dir = os.path.dirname(dest_path)

raw = open(frag_path).read()
raw = raw.replace('__NODE__', node).replace('__CLAUDE_DIR__', claude_dir)
frag = json.loads(raw)

dest = {}
if os.path.exists(dest_path):
    try:
        dest = json.load(open(dest_path))
    except json.JSONDecodeError:
        pass

def group_cmds(g):
    return tuple(sorted(h.get('command', '') for h in g.get('hooks', [])))

dest.setdefault('hooks', {})
for ev, groups in frag.get('hooks', {}).items():
    have = {group_cmds(g) for g in dest['hooks'].get(ev, [])}
    dest['hooks'].setdefault(ev, [])
    for g in groups:
        if group_cmds(g) not in have:
            dest['hooks'][ev].append(g)

if 'statusLine' not in dest and 'statusLine' in frag:
    dest['statusLine'] = frag['statusLine']

with open(dest_path, 'w') as f:
    json.dump(dest, f, indent=2)
print(f'settings merged -> {dest_path}')
