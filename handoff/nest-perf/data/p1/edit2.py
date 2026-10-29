import re, glob
base = '/home/vitalii/scriptc/.claude/worktrees/agent-a85f0c88bb683b352/packages/compiler/src/backend/llvm/'
m = {'1': 'CLOSURE_FIELD.fn', '2': 'CLOSURE_FIELD.ncaps', '3': 'CLOSURE_FIELD.props', '4': 'CLOSURE_FIELD.functionKind', '7': 'CLOSURE_FIELD.fnBorrowed'}
pat = re.compile(r'(%ScrClosure, ptr [^,]+, i(?:64|32) 0, i32 )(\d+)')
total = 0
for f in glob.glob(base + '*.ts'):
    s = open(f).read()
    if '%ScrClosure, ptr' not in s:
        continue
    if f.endswith('closure-layout.ts'):
        continue
    test = f.endswith('.test.ts')
    def rep(mo):
        global total
        total += 1
        n = mo.group(2)
        if n not in m:
            raise Exception('unexpected field ' + n + ' in ' + f)
        idx = {'1': 10, '2': 11, '3': 12, '4': 18, '7': 17}[n]
        if test:
            return mo.group(1) + str(idx)
        return mo.group(1) + '${' + m[n] + '}'
    s2 = pat.sub(rep, s)
    if s2 != s and not test:
        # add import
        rel = 'closure-layout.js'
        imp = 'import { CLOSURE_FIELD } from "./%s";\n' % rel
        if imp not in s2:
            # after the last import line at top
            lines = s2.split('\n')
            first = next(i for i,l in enumerate(lines) if l.startswith('import '))
            lines.insert(first, imp.rstrip('\n'))
            s2 = '\n'.join(lines)
    open(f, 'w').write(s2)
print('replaced', total)
