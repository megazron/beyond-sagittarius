# Plays BEYOND SAGITTARIUS in the owner's Chrome over the DevTools protocol, on the real GPU. Stdlib only.
import base64, hashlib, json, os, socket, struct, sys, time, urllib.request
PORT=9333; URL=sys.argv[1]; OUT=sys.argv[2]; os.makedirs(OUT,exist_ok=True)
class WS:
    def __init__(s,url):
        h=url.split('/',3); host,port=h[2].split(':'); s.c=socket.create_connection((host,int(port))); k=base64.b64encode(os.urandom(16)).decode()
        s.c.sendall(f"GET /{h[3]} HTTP/1.1\r\nHost: {h[2]}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {k}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        b=b''
        while b'\r\n\r\n' not in b: b+=s.c.recv(1)
        s.i=0
    def rd(s,n):
        b=b''
        while len(b)<n:
            x=s.c.recv(n-len(b))
            if not x: raise EOFError
            b+=x
        return b
    def recv(s):
        data=b''
        while True:
            a,b=s.rd(2); fin=a&128; op=a&15; n=b&127
            if n==126: n=struct.unpack('>H',s.rd(2))[0]
            elif n==127: n=struct.unpack('>Q',s.rd(8))[0]
            p=s.rd(n)
            if op==9: s.frame(p,10); continue
            data+=p
            if fin: return data
    def frame(s,p,op=1):
        m=os.urandom(4); n=len(p); h=bytes([128|op])
        h+=bytes([128|n]) if n<126 else bytes([128|126])+struct.pack('>H',n) if n<65536 else bytes([128|127])+struct.pack('>Q',n)
        s.c.sendall(h+m+bytes(c^m[i%4] for i,c in enumerate(p)))
    def call(s,method,**params):
        s.i+=1; s.frame(json.dumps({'id':s.i,'method':method,'params':params}).encode())
        while True:
            r=json.loads(s.recv())
            if r.get('method')=='Runtime.exceptionThrown': errs.append(r['params']['exceptionDetails'].get('text','')+' '+str(r['params']['exceptionDetails'].get('exception',{}).get('description',''))[:200])
            if r.get('id')==s.i:
                if 'error' in r: raise RuntimeError(r['error'])
                return r['result']
errs=[]
t=json.load(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{PORT}/json/new?about:blank',method='PUT')))
w=WS(t['webSocketDebuggerUrl']); w.call('Page.enable'); w.call('Runtime.enable')
def ev(x,aw=False):
    r=w.call('Runtime.evaluate',expression=x,returnByValue=True,awaitPromise=aw)
    if 'exceptionDetails' in r: raise RuntimeError(str(r['exceptionDetails'])[:300])
    return r['result'].get('value')
def wait(x,sec):
    t0=time.time()
    while time.time()-t0<sec:
        try:
            if ev(x): return True
        except RuntimeError: pass
        time.sleep(0.25)
    print('TIMEOUT',x); return False
def shot(n):
    open(f'{OUT}/{n}.jpg','wb').write(base64.b64decode(w.call('Page.captureScreenshot',format='jpeg',quality=85)['data']))
FPS="new Promise(r=>{let n=0,t0=performance.now(),last=t0,worst=0;function f(t){n++;worst=Math.max(worst,t-last);last=t;if(t-t0<SEC)requestAnimationFrame(f);else r({fps:+(n*1000/(t-t0)).toFixed(1),worst_ms:+worst.toFixed(0)})}requestAnimationFrame(f)})"
res={}
w.call('Page.navigate',url=URL)
wait("window.__bs && window.__bs.state==='title'",90); ev("localStorage.removeItem('bs-save-v1')"); w.call('Page.reload'); time.sleep(2)
wait("window.__bs && window.__bs.state==='title'",90); wait("window.__bs.ready",180)
res['gpu']=ev("(()=>{const c=document.createElement('canvas'),g=c.getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})()")
res['quality']=ev("(()=>{try{return window.__bs.quality?.name||window.__bs.quality||JSON.stringify(localStorage)}catch(e){return ''}})()")
shot('1-title'); res['title']=ev(FPS.replace('SEC','4000'),True)
ev("document.querySelector('#btn-new').click()"); wait("!!document.querySelector('#nm-ok')",15); time.sleep(.5); shot('2-names'); ev("document.querySelector('#nm-ok').click()")
wait("window.__bs.state==='narrator'",30); time.sleep(6); shot('3-narrator'); res['narrator']=ev(FPS.replace('SEC','5000'),True)
ev("document.querySelector('#btn-skip').click()"); wait("window.__bs.state==='cinematic'",30); time.sleep(8); shot('4-cinematic'); res['cinematic']=ev(FPS.replace('SEC','5000'),True)
ev("document.querySelector('#btn-skip').click()"); wait("window.__bs.state==='game'",90); time.sleep(3); shot('5-wake')
ev("document.dispatchEvent(new KeyboardEvent('keydown',{code:'Enter',key:'Enter',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{code:'Enter',key:'Enter',bubbles:true}))")
wait("window.__bs.mode==='play'",20); time.sleep(4); shot('6-play'); res['play']=ev(FPS.replace('SEC','8000'),True)
res['mode']=ev("window.__bs.mode"); res['errors']=errs[:8]
print(json.dumps(res,indent=1))
urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{PORT}/json/close/{t['id']}"))
