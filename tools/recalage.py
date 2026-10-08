import json, numpy as np, os, sys
from PIL import Image
R=os.path.expanduser('~/mnt/Documents/Deadrop Project')
d=json.load(open(R+'/data/archives.json'))
def to_frame(a,o):
    if o==0: return a
    if o==1: return a[:, ::-1].T
    return a[::-1, :].T
def lum(im): 
    a=np.asarray(im.convert('RGB'),dtype=np.float64)/255; return a@[0.2126,0.7152,0.0722]
def crop_nasa(L):
    M=L.copy(); M[:, :40]=0   # bande du filigrane à gauche
    ys,xs=np.where(M>0.06)
    y0,y1,x0,x1=ys.min(),ys.max()+1,xs.min(),xs.max()+1
    return (int(x0),int(y0),int(x1),int(y1))
def resize(a,w,h):
    return np.asarray(Image.fromarray(a.astype(np.float32),mode='F').resize((w,h),Image.BILINEAR),dtype=np.float64)
def edges(a):
    g=np.zeros_like(a); g[:,1:]=np.abs(np.diff(a,axis=1)); return g
def ncc_best(T,S):
    # T cible (H,W), S source plus petite : corrélation par FFT, normalisée grossièrement
    H,W=T.shape; h,w=S.shape
    if h>H or w>W: return -1,(0,0)
    Tz=T-T.mean(); Sz=S-S.mean()
    F=np.fft.rfft2(Tz); G=np.fft.rfft2(Sz,s=(H,W))
    c=np.fft.irfft2(F*np.conj(G),s=(H,W))
    c=c[:H-h+1,:W-w+1]
    # normalisation par l'énergie locale de T
    I=np.cumsum(np.cumsum(np.pad(Tz**2,((1,0),(1,0))),0),1)
    e=I[h:,w:]-I[:-h,w:]-I[h:,:-w]+I[:-h,:-w]
    c=c/np.sqrt(np.maximum(e[:H-h+1,:W-w+1],1e-9)*(Sz**2).sum())
    i=np.unravel_index(np.argmax(c),c.shape); return float(c[i]),(int(i[1]),int(i[0]))
out=[]
for r in d['images']:
    if not r['fichier_nasa']: continue
    o=r['orientation']
    D=to_frame(lum(Image.open(R+'/'+r['fichier_decode'])),o)   # (364,540) p×t
    N=lum(Image.open(R+'/'+r['fichier_nasa']))
    box=crop_nasa(N); S0=to_frame(N[box[1]:box[3],box[0]:box[2]],o)
    ED=edges(D); best=(-2,)
    for sx in np.arange(0.40,1.20,0.02):
        for a in np.arange(-0.12,0.121,0.03):
            sy=sx*(1+a); w=int(round(S0.shape[1]*sx)); h=int(round(S0.shape[0]*sy))
            if w<50 or h<50: continue
            sc,(ox,oy)=ncc_best(ED,edges(resize(S0,w,h)))
            if sc>best[0]: best=(sc,sx,sy,ox,oy,w,h)
    sc,sx,sy,ox,oy,w,h=best
    # affinage
    for sx2 in np.arange(sx-0.02,sx+0.021,0.005):
        for sy2 in np.arange(sy-0.03,sy+0.031,0.005):
            w2=int(round(S0.shape[1]*sx2)); h2=int(round(S0.shape[0]*sy2))
            sc2,(ox2,oy2)=ncc_best(ED,edges(resize(S0,w2,h2)))
            if sc2>best[0]: best=(sc2,sx2,sy2,ox2,oy2,w2,h2)
    sc,sx,sy,ox,oy,w,h=best
    rec=dict(id=r['id'],orientation=o,nasa_crop=box,frame_rect=[ox,oy,w,h],scale=[round(float(sx),4),round(float(sy),4)],score=round(sc,3))
    out.append(rec); print(rec,flush=True)
json.dump(dict(_meta=dict(description="Recalage des 30 images NASA dans l'espace « trame » (364 pixels × 540 traces) des décodages de Ron Barry. frame_rect = [trace de départ, pixel de départ, largeur en traces, hauteur en pixels] ; nasa_crop = [x0,y0,x1,y1] dans le GIF NASA avant rotation.", methode="corrélation normalisée des bords (dérivée le long des traces), recherche d'échelle x/y puis affinage", outil="spatialbox/tools/recalage.py"),paires=out),open(R+'/data/calibration-pairs.json','w'),indent=1,ensure_ascii=False)
