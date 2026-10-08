# Mesures de référence sur le vrai signal du Golden Record (384 kHz, float32 stéréo)
import numpy as np, json, os, re
R=os.path.expanduser('~/mnt/Documents/Deadrop Project')
P=R+'/golden-record-decode/travail/384kHzStereo.wav'; SR=384000
mm=np.memmap(P,dtype='<f4',mode='r',offset=88).reshape(-1,2)
src=open(R+'/golden-record-decode/travail/voyager.cpp').read()
blk=src[src.index('start_points[2]'):]; blk=blk[:blk.index('};')]
chs=blk.split('},')[:2]; SP=[]
for c in chs:
    c=re.sub(r'//[^\n]*','',c.split('{',2)[-1]); items=[e for e in c.split(',') if e.strip()]
    SP.append([eval(e.strip().replace('audio_sample_rate',str(SR))) for e in items])
d=json.load(open(R+'/data/archives.json'))['images']
def troughs(x,n=540):
    out=[]; s=0
    for k in range(n+1):
        a=s+int(np.argmax(x[s:s+190])); b=a+int(np.argmin(x[a:a+190])); out.append((a,b)); s=b+3000
    return np.array(out)
sel=[r for r in d if r['position'] in (3,10,12,17,33,43,54,56,63,73,93,99,103,106,110,116)]
per=[];alt=[];tpl=[];prof=[];lv=[];drift=[]
for r in sel:
    ch=0 if r['piste']=='gauche' else 1
    for f in r['positions_signal'][:1]:
        st=SP[ch][f]; x=np.array(mm[st:st+545*3300,ch],dtype=np.float64)
        T=troughs(x); B=T[:,1]; dB=np.diff(B)
        per.append(dB.mean()); alt.append(np.abs(dB[1::2].mean()-dB[0::2].mean()))
        tpl.append(np.mean([x[b-300:b+300] for b in B[2:-2]],0))
        W=np.array([x[b:b+3150] for b in B[:-1]])
        prof.append(W.std(0))
        img=np.concatenate([x[b+220:b+2900] for b in B[:-1]]); lv.append(np.percentile(img,[0.5,2,50,98,99.5]))
        m=np.array([x[b+220:b+2900].mean() for b in B[:-1]]); drift.append(m)
per=np.array(per); tpl=np.mean(tpl,0); prof=np.mean(prof,0); lv=np.array(lv)
core=prof[:2980]; med=np.median(core[400:2600]); act=np.where(core>med*0.5)[0]; act=act[(act>60)]
res=dict(
 _meta=dict(description="Mesures sur le signal réel (384kHzStereo.wav) — base des paramètres de l'encodeur", images_mesurees=[r['id'] for r in sel], outil="spatialbox/tools/analyse-signal.py", date="2026-09-29"),
 frequence_echantillonnage=SR,
 periode_trace_echantillons=dict(moyenne=round(float(per.mean()),2),min=round(float(per.min()),2),max=round(float(per.max()),2)),
 periode_trace_ms=round(float(per.mean())/SR*1000,3),
 alternance_paire_impaire_echantillons=round(float(np.mean(alt)),2),
 synchro_gabarit=dict(debut=-300,pas=1,valeurs=[round(float(v),4) for v in tpl]),
 fenetre_image=dict(debut_apres_creux=int(act.min()),fin_apres_creux=int(act.max()),barry=[220,2900]),
 profil_activite_pas10=[round(float(v),4) for v in prof[::10]],
 niveaux_image_percentiles=dict(p0_5=round(float(lv[:,0].mean()),4),p2=round(float(lv[:,1].mean()),4),p50=round(float(lv[:,2].mean()),4),p98=round(float(lv[:,3].mean()),4),p99_5=round(float(lv[:,4].mean()),4)),
 moyenne_par_trace=dict(ecart_type_moyen=round(float(np.mean([m.std() for m in drift])),4)),
)
json.dump(res,open(R+'/data/signal-reference.json','w'),indent=1,ensure_ascii=False)
print({k:v for k,v in res.items() if k not in('synchro_gabarit','profil_activite_pas10')})
t=np.array(res['synchro_gabarit']['valeurs']); print('gabarit (pas 10):',np.round(t[::10],3))
