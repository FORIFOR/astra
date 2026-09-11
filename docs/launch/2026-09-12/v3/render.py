from pathlib import Path
import subprocess, json, shutil
p=Path('/tmp/astra-launch-v3'); out=Path('/Users/shuhei/Downloads/Astra-Launch/v3');out.mkdir(exist_ok=True)
D=[4,3,4,2,2,9,4,5]
def run(a):subprocess.run(a,check=True)
def ff(a):run(['ffmpeg','-y','-hide_banner','-loglevel','error',*a])
# The original score is composed locally for Astra; narration is licensed Cloud TTS.
inputs=['-stream_loop','-1','-i','/tmp/astra-launch-v2/original-score.wav']
for i in range(7): inputs+=['-i',str(p/f'voice-{i}.wav')]
filters=['[0:a]volume=0.16,atrim=0:33,afade=t=out:st=30:d=3[bed]']
for i,t in enumerate([.2,4.25,7.2,11.2,17.6,24.2,28.3]):filters.append(f'[{i+1}:a]adelay={int(t*1000)}|{int(t*1000)}[v{i}]')
filters+=['[bed]'+''.join(f'[v{i}]' for i in range(7))+'amix=inputs=8:duration=longest:normalize=0,atrim=0:33,loudnorm=I=-16:TP=-1.5:LRA=8[a]']
ff(inputs+['-filter_complex',';'.join(filters),'-map','[a]','-ar','48000',str(p/'mix.wav')])
for mode in ['social','web']:
 W,H=(1080,1920) if mode=='social' else (1920,1080); portrait=mode=='social'
 art=p/'art-wide-cfr.mp4'
 for i,d in enumerate(D):
  dst=p/f'{mode}-scene-{i}.mp4'; overlays=p/f'{mode}-{i}.png'
  # All moving product imagery comes from the actual browser or native Mac capture.
  start=[1,1,1,1,1,0,59,5][i]
  source=p/f'proof-{mode}.mp4' if i==5 else art
  ins=['-ss',str(start),'-i',str(source)]
  chain=[]
  if i==5:
   base='crop=1080:1030:0:620,pad=1080:1920:0:270:color=0x050811' if portrait else 'scale=1300:916,pad=1920:1080:310:20:color=0x050811'
  else:
   base='crop=960:730:480:330,scale=1920:1460,crop=1080:1460:420:0,pad=1080:1920:0:120:color=0x050811' if portrait else 'crop=1920:730:0:330,pad=1920:1080:0:110:color=0x050811'
  if i in [1,2,3]:base+=',eq=brightness=-0.15:saturation=0.55,gblur=sigma=12'
  if i==7:base+=',eq=brightness=-0.28'
  chain.append('[0:v]'+base+',setsar=1[bg]');label='bg';oi=1
  if i in [1,2,3]:
   if i==1:
    ins+=['-loop','1','-i',str(p/'orbit-sketch.png')];f='scale=1000:-2' if portrait else 'scale=1250:-2';xy='40:400' if portrait else '335:85'
   elif i==2:
    ins+=['-ss','1.5','-i',str(p/'final-creation-cfr.mp4')];f='crop=770:400:430:120,scale=1040:-2' if portrait else 'crop=1000:580:300:50,scale=1600:-2';xy='20:445' if portrait else '160:70'
   elif i==3:
    ins+=['-ss','0','-i',str(p/'native-result-cfr.mp4')];f='crop=900:580:350:100,scale=1040:-2' if portrait else 'crop=1200:750:90:60,scale=1630:-2';xy='20:330' if portrait else '145:35'
   else:
    ins+=['-ss','17','-i',str(p/'native-result-cfr.mp4')];f='crop=760:610:296:130,scale=1040:-2' if portrait else 'crop=1100:710:150:80,scale=1550:-2';xy='20:290' if portrait else '185:15'
   chain+=['[1:v]'+f+',setsar=1[fg]',f'[bg][fg]overlay={xy}:shortest=1[scene]'];label='scene';oi=2
  ins+=['-loop','1','-i',str(overlays)]
  chain += [f'[{oi}:v]scale={W}:{H}[ov]',f'[{label}][ov]overlay=0:0:shortest=1,format=yuv420p,fps=30[v]']
  ff(ins+['-filter_complex',';'.join(chain),'-map','[v]','-t',str(d),'-an','-c:v','libx264','-preset','fast','-crf','18',str(dst)])
 (p/f'{mode}-concat.txt').write_text(''.join(f"file '{p}/{mode}-scene-{i}.mp4'\n" for i in range(8)))
 ff(['-f','concat','-safe','0','-i',str(p/f'{mode}-concat.txt'),'-i',str(p/'mix.wav'),'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','192k','-t','33','-movflags','+faststart',str(out/f'astra-orbit-{mode}.mp4')])
 ff(['-ss','1','-i',str(out/f'astra-orbit-{mode}.mp4'),'-frames:v','1',str(out/f'poster-{mode}.jpg')])
print('RENDERED',out)
