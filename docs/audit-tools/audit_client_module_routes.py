import os
"""Static literal-import and file check for DesignCraft's declared client routes."""
from pathlib import Path
import re
import sys

product = Path(os.environ.get('DESIGNCRAFT_AUDIT_ROOT','D:/METIS超级合并/dsh-plugin/designcraft'))
index = (product / 'host/index.js').read_text(encoding='utf-8')
assets = (product / 'host/editor-assets.js').read_text(encoding='utf-8')
declaration = re.search(r'const clientFiles\s*=\s*\[(.*?)\];', index, re.S)
shared = re.search(r'EDITOR_SHARED_MODULES=Object\.freeze\(\[(.*?)\]\)', assets, re.S)
if not declaration or not shared or '...EDITOR_SHARED_MODULES' not in declaration.group(1):
    sys.exit('无法识别客户端路由声明，未作通过结论')

names = re.findall(r"'([A-Za-z0-9._-]+\.js)'", declaration.group(1))
names += re.findall(r"'([A-Za-z0-9._-]+\.js)'", shared.group(1))
if len(names) != len(set(names)):
    sys.exit('客户端路由声明存在重复文件')
served = set(names)
issues = []
refs = 0
pattern = re.compile(r'''(?:\bfrom\s*|\bimport\s*\(?\s*)["']\./([A-Za-z0-9._-]+\.js)(?:\?[^"']*)?["']''')
for name in sorted(served):
    source = product / 'client' / name
    if not source.is_file() or source.is_symlink():
        issues.append(f'{name}: 声明的客户端文件缺失或为符号链接')
        continue
    for target in pattern.findall(source.read_text(encoding='utf-8')):
        refs += 1
        if target not in served:
            issues.append(f'{name}: 未声明相对模块 {target}')

if issues:
    print('\n'.join(issues))
    sys.exit(1)
print(f'静态核对 {len(served)} 个声明文件、{refs} 个可识别相对 JS 引用：均在路由表；未运行服务或界面。')
