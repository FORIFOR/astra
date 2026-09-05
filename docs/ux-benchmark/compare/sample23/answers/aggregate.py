import json, glob, os, re, sys
S=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
key={}
for line in open(os.path.join(S,"answers","key.txt"),encoding="utf-8"):
    m=re.match(r"(\w+): (\w{4}) astra-HEAD .*?  (\w{4}) competitor",line)
    if m: key[m.group(1)]={"A":m.group(2),"C":m.group(3)}
out={}; totals={"A":0,"C":0,"tie":0,"ct":0,"split":0}
for t,ids in key.items():
    res={}
    for f in sorted(glob.glob(os.path.join(S,"results",f"{t}-*.json"))):
        who=os.path.basename(f).split("-")[1].split(".")[0]
        try: j=json.load(open(f,encoding="utf-8"))
        except Exception as e: print("bad json",f,e); continue
        for ax,w in j.get("winners",{}).items():
            v="A" if w==ids["A"] else "C" if w==ids["C"] else "tie" if w=="tie" else "ct"
            res.setdefault(ax,{})[who]=v
    rows=[]
    for ax,d in res.items():
        vals=list(d.values())
        r=vals[0] if len(set(vals))==1 else "split"
        rows.append({"axis":ax,**d,"result":r}); totals[r]=totals.get(r,0)+1
    out[t]=rows
json.dump(out,open(os.path.join(S,"answers","aggregate.json"),"w",encoding="utf-8"),ensure_ascii=False,indent=1)
for t,rows in out.items():
    c={"A":0,"C":0,"tie":0,"ct":0,"split":0}
    for r in rows: c[r["result"]]+=1
    print(f"{t:18s} A={c['A']} C={c['C']} tie={c['tie']} ct={c['ct']} split={c['split']}")
print("total",totals)
