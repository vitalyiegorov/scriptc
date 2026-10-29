import json,sys,collections
t=collections.Counter();lines=0;withside=0
for l in open(sys.argv[1]):
    l=l.strip()
    if not l: continue
    try: d=json.loads(l)
    except: continue
    lines+=1
    for k,v in d.items():
        if k.startswith('func_'): t[k]+=v
    if d.get('func_side_node',0): withside+=1
print('processes',lines,'with-side',withside)
for k,v in sorted(t.items()): print(' ',k,v)
