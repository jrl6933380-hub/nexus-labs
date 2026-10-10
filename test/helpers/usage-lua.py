# Run the production Redis Lua script against a tiny GET/SET store for ledger tests.
import ctypes as C, ctypes.util, json, sys
name=next((ctypes.util.find_library(n) for n in ['lua5.4','lua5.3'] if ctypes.util.find_library(n)),None)
if not name:
    sys.exit(77)
lua=C.CDLL(name); ptr=C.c_void_p
for fn,rest,args in [('luaL_newstate',ptr,[]),('luaL_openlibs',None,[ptr]),('lua_close',None,[ptr]),('lua_gettop',C.c_int,[ptr]),('lua_settop',None,[ptr,C.c_int]),('lua_type',C.c_int,[ptr,C.c_int]),('lua_tolstring',ptr,[ptr,C.c_int,ptr]),('lua_tonumberx',C.c_double,[ptr,C.c_int,ptr]),('lua_toboolean',C.c_int,[ptr,C.c_int]),('lua_pushnil',None,[ptr]),('lua_pushboolean',None,[ptr,C.c_int]),('lua_pushnumber',None,[ptr,C.c_double]),('lua_pushlstring',ptr,[ptr,C.c_char_p,C.c_size_t]),('lua_createtable',None,[ptr,C.c_int,C.c_int]),('lua_settable',None,[ptr,C.c_int]),('lua_next',C.c_int,[ptr,C.c_int]),('lua_setglobal',None,[ptr,C.c_char_p]),('luaL_loadstring',C.c_int,[ptr,C.c_char_p]),('lua_pcallk',C.c_int,[ptr,C.c_int,C.c_int,C.c_int,C.c_longlong,ptr])]:
    getattr(lua,fn).restype=rest;getattr(lua,fn).argtypes=args
CALL=C.CFUNCTYPE(C.c_int,ptr);lua.lua_pushcclosure.argtypes=[ptr,CALL,C.c_int]
L=lua.luaL_newstate();lua.luaL_openlibs(L)
def push(v):
    if v is None:lua.lua_pushnil(L)
    elif isinstance(v,bool):lua.lua_pushboolean(L,v)
    elif isinstance(v,(int,float)):lua.lua_pushnumber(L,v)
    elif isinstance(v,str):
        b=v.encode();lua.lua_pushlstring(L,b,len(b))
    else:
        lua.lua_createtable(L,0,0)
        for k,x in (enumerate(v,1) if isinstance(v,list) else v.items()):push(k);push(x);lua.lua_settable(L,-3)
def read(i):
    if i<0:i=lua.lua_gettop(L)+i+1
    t=lua.lua_type(L,i)
    if t==0:return None
    if t==1:return bool(lua.lua_toboolean(L,i))
    if t==3:return lua.lua_tonumberx(L,i,None)
    if t==4:return C.string_at(lua.lua_tolstring(L,i,None)).decode()
    if t==5:
        d={};lua.lua_pushnil(L)
        while lua.lua_next(L,i):d[read(-2)]=read(-1);lua.lua_settop(L,-2)
        return d
    raise ValueError(t)
input=json.load(sys.stdin);store=input.get('store',{})
@CALL
def decode(_):push(json.loads(read(1)));return 1
@CALL
def encode(_):push(json.dumps(read(1)));return 1
@CALL
def redis_call(_):
    verb,key=read(1),read(2)
    if verb=='GET':push(store.get(key))
    elif verb=='SET':store[key]=read(3);push('OK')
    else:raise ValueError(verb)
    return 1
for n,fn in [('decode',decode),('encode',encode),('redis_call',redis_call)]:lua.lua_pushcclosure(L,fn,0);lua.lua_setglobal(L,n.encode())
parts=input['command'];n=int(parts[2]);push(parts[3:3+n]);lua.lua_setglobal(L,b'KEYS');push([str(v) for v in parts[3+n:]]);lua.lua_setglobal(L,b'ARGV')
source='cjson={decode=decode,encode=encode};redis={call=redis_call};\n'+parts[1]
code=lua.luaL_loadstring(L,source.encode()) or lua.lua_pcallk(L,0,1,0,0,None)
if code:raise RuntimeError(read(-1))
print(json.dumps({'result':read(-1),'store':store}));lua.lua_close(L)
