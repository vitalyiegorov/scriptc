import sys,re,collections
names={}
cost=collections.Counter()
cur=None;skip=False
for line in open(sys.argv[1]):
    line=line.rstrip('\n')
    if line.startswith('fn='):
        m=re.match(r'fn=\((\d+)\)(?: (.*))?',line)
        if m.group(2): names[m.group(1)]=m.group(2)
        cur=m.group(1); continue
    for pre in ('cfn=','cfi=','cfl=','cob='):
        pass
    if line.startswith('cfn='):
        m=re.match(r'cfn=\((\d+)\)(?: (.*))?',line)
        if m.group(2): names[m.group(1)]=m.group(2)
        continue
    if line.startswith('calls='): skip=True; continue
    if line and (line[0].isdigit() or line[0] in '+-*'):
        if skip: skip=False; continue
        p=line.split()
        if len(p)>=2 and cur: cost[cur]+=int(p[1])
tot=sum(cost.values())
n=int(sys.argv[2]) if len(sys.argv)>2 else 40
req=300
print('total/req',tot/req)
for k,v in cost.most_common(n): print(f'{v/req:9.0f} {names.get(k,k)}')
