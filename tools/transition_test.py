# Scene-transition stall test on a real GPU, stdlib only. Same setup as gpu_test.py:
# start Chrome with --remote-debugging-port=9333, then
#   python tools/transition_test.py https://megazron.github.io/beyond-sagittarius/?quality=web out_dir
# Goes through every scene change and fails if any long task after loading tops 200 ms.
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
LIMIT=200
w.call('Page.navigate',url=URL)
wait("window.__bs && window.__bs.state==='title'",90); ev("localStorage.removeItem('bs-save-v1')"); w.call('Page.reload'); time.sleep(2)
t_load=time.time(); wait("window.__bs && window.__bs.ready",180); print('ready after',round(time.time()-t_load),'s',flush=True); time.sleep(4)
mark=ev("performance.now()"); marks=[]
def step(name):
    marks.append((name,ev("performance.now()"))); print('->',name,flush=True)
step('title to creator'); ev("document.getElementById('btn-new').click()"); wait("document.getElementById('nm-ok')",10); time.sleep(2)
step('creator to narrator'); ev("document.getElementById('nm-ok').click()"); wait("__bs.state==='narrator'&&__bs.vault.playing",30); time.sleep(5)
step('narrator to cinematic'); ev("__bs.skip()"); wait("__bs.state==='cinematic'",30); time.sleep(3)
step('deck scene'); ev("__bs.cineSeek(33.45)"); time.sleep(6)
step('deck to event'); ev("__bs.skip()"); time.sleep(4)
step('cinematic to wake'); ev("__bs.skip()"); wait("__bs.mode==='wake'",60); time.sleep(4)
step('wake to play'); ev("__bs.skip()"); wait("__bs.mode==='play'",30); time.sleep(6)
step('world to Vault'); ev("__bs.sceneTest('l3')"); wait("__bs.state==='narrator'&&__bs.vault.playing",30); time.sleep(4)
step('Vault to world'); ev("__bs.skip()"); wait("__bs.state==='game'",30); time.sleep(4)
step('world to flashback'); ev("__bs.sceneTest('fight')"); wait("__bs.state==='flashback'",30); time.sleep(5)
step('flashback to world'); ev("__bs.skip()"); wait("__bs.state==='game'",30); time.sleep(5)
tasks=ev("__bs.longTasks")
marks.append(('end',ev("performance.now()")))
bad=0
for (n,t0),(_,t1) in zip(marks,marks[1:]):
    ts=[x for x in tasks if t0<=x['t']<t1]
    worst=max([x['ms'] for x in ts if not x.get('covered')],default=0)  # stalls behind a full black fade can't be seen
    flag='FAIL' if worst>LIMIT else 'ok'
    bad+=worst>LIMIT
    print(f"{flag:4} {n:24} worst {worst} ms, {len(ts)} long tasks")
json.dump({'marks':marks,'tasks':tasks},open(f'{OUT}/transitions.json','w'))
print('page errors:',errs[:5])
sys.exit(1 if bad or errs else 0)
