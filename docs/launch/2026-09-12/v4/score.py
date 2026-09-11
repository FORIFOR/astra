from pathlib import Path
import math,array,wave,random
# Original stereo ambient score; no samples, commercial music, or cloned voices.
sr=48000;duration=42; random.seed(81); out=array.array('h')
chords=[[146.8324,220,277.1826,329.6276],[130.8128,196,246.9417,293.6648],[164.8138,246.9417,311.127,369.9944],[110,164.8138,207.6523,246.9417]]
for i in range(sr*duration):
 t=i/sr; bar=int(t/6)%4;beat=t%0.6;step=int(t/0.6);freq=chords[bar][step%4]*2
 env=(1-math.exp(-beat*70))*math.exp(-beat*5.5)
 pluck=(math.sin(2*math.pi*freq*t)+0.10*math.sin(2*math.pi*freq*3*t))*env*.075
 pad=sum(math.sin(2*math.pi*(f+0.18*math.sin(t*.3))*t) for f in chords[bar])*.011
 low=math.sin(2*math.pi*chords[bar][0]*.5*t)*.04
 kick=math.sin(2*math.pi*(43*beat+3*(1-math.exp(-beat*20))))*math.exp(-beat*27)*.09 if step%2==0 else 0
 brush=(random.random()*2-1)*math.exp(-beat*100)*.012
 fade=min(1,t/.6,(duration-t)/2);v=(pluck+pad+low+kick+brush)*fade
 pan=.18*math.sin(t*.5)
 out.extend([int(max(-.95,min(.95,v*(1-pan)))*32767),int(max(-.95,min(.95,v*(1+pan)))*32767)])
with wave.open('/tmp/astra-launch-v4/score.wav','wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(sr);f.writeframes(out.tobytes())
