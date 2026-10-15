import struct
import re
from pathlib import Path
import os
from collections import deque
from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM, UC_HOOK_CODE, UC_HOOK_INTR
from unicorn.arm64_const import *
from elftools.elf.elffile import ELFFile

ROOT=Path(os.environ['GAME_ANALYSIS_DIR'])
class NativeVM:
    READ_TYPES={0x13de78:'vint',0x2bf360:'int',0x2da5c8:'int',0x314530:'string',0x37e628:'string-object',0x1cba10:'long',0x3ff2c4:'bytes'}

    def __init__(self, trace_instructions=True, heap_size=0x1000000):
        if not isinstance(heap_size,int) or heap_size<0x1000 or heap_size>0x10000000 or heap_size%0x1000:
            raise ValueError('VM heap size must be page-aligned and at most 256 MiB')
        self.uc=Uc(UC_ARCH_ARM64,UC_MODE_ARM)
        self.memory=(ROOT/'memory.bin').read_bytes()
        self.uc.mem_map(0,(len(self.memory)+4095)&~4095)
        self.uc.mem_write(0,self.memory)
        self.uc.mem_map(0x10000000,heap_size)
        self.heap=0x10000000
        self.heap_limit=self.heap+heap_size
        self.uc.mem_map(0x20000000,0x200000)
        self.uc.reg_write(UC_ARM64_REG_SP,0x201f0000)
        self.uc.reg_write(UC_ARM64_REG_TPIDR_EL0,0x20000000)
        self.stop=0x20001000
        self.trace=deque(maxlen=20)
        self.reads=[]
        self.input_stream=None
        self.imports={}
        elf=ELFFile(open(ROOT/'libg.so','rb'))
        rel=elf.get_section_by_name('.rela.plt');sym=elf.get_section(rel['sh_link'])
        for n,r in enumerate(rel.iter_relocations()):
            self.imports[0xdf690+32+n*16]=sym.get_symbol(r['r_info_sym']).name
        self.hooks={}
        self.mutexes=set()
        self.entropy=os.urandom
        self.random_fds=set()
        self.trace_instructions=trace_instructions
        self.code_hook=None
        self.point_hooks=[]
        if trace_instructions:
            self.code_hook=self.uc.hook_add(UC_HOOK_CODE,self.on_code)
        else:
            for address in sorted(set(self.imports) | set(self.READ_TYPES)):
                self.point_hooks.append(self.uc.hook_add(UC_HOOK_CODE,self.on_code,begin=address,end=address))
        self.uc.hook_add(UC_HOOK_INTR,self.on_intr)
    def register_hook(self,address,callback):
        self.hooks[address]=callback
        if not self.trace_instructions and address not in self.imports and address not in self.READ_TYPES:
            self.point_hooks.append(self.uc.hook_add(UC_HOOK_CODE,self.on_code,begin=address,end=address))
    def alloc(self,size):
        assert isinstance(size,int) and 0<=size<0x400000, f'Allocation too large: {size}'
        ptr=self.heap;end=ptr+((max(size,16)+15)&~15)
        assert end<=self.heap_limit, 'VM heap exhausted'
        self.heap=end
        self.uc.mem_write(ptr,bytes(max(size,16)))
        return ptr
    def reg(self,n): return self.uc.reg_read(UC_ARM64_REG_X0+n)
    def ret(self,value=0):
        self.uc.reg_write(UC_ARM64_REG_X0,value & 0xffffffffffffffff)
        self.uc.reg_write(UC_ARM64_REG_PC,self.uc.reg_read(UC_ARM64_REG_LR))
    def string(self,ptr):
        out=bytearray()
        for n in range(100000):
            b=self.uc.mem_read(ptr+n,1)[0]
            if b==0:return bytes(out)
            out.append(b)
        raise ValueError('unterminated string')
    def on_code(self,uc,address,size,_):
        self.trace.append(hex(address))
        if address in self.READ_TYPES and self.reg(0)==self.input_stream:
            offset=struct.unpack('<I',self.uc.mem_read(self.input_stream+0x14,4))[0]
            self.reads.append({'type':self.READ_TYPES[address],'offset':offset,'caller':hex(self.uc.reg_read(UC_ARM64_REG_LR))})
        if address in self.hooks:
            self.hooks[address](self); return
        name=self.imports.get(address)
        if not name:return
        a,b,c=self.reg(0),self.reg(1),self.reg(2)
        if name=='open':
            path=self.string(a)
            if path not in [b'/dev/urandom',b'/dev/random']:raise RuntimeError(f'Unsupported file access: {path!r}')
            fd=1000+len(self.random_fds);self.random_fds.add(fd);return self.ret(fd)
        if name=='read':
            if a not in self.random_fds or c>1048576:raise RuntimeError('Unsupported VM read')
            self.uc.mem_write(b,self.entropy(c));return self.ret(c)
        if name=='close':
            if a not in self.random_fds:raise RuntimeError('Unsupported VM close')
            self.random_fds.remove(a);return self.ret(0)
        if name in ['pthread_cond_broadcast','pthread_cond_signal']:return self.ret(0) # No other VM threads.
        if name=='getpid':return self.ret(os.getpid())
        if name=='pthread_self':return self.ret(0x20000000)
        if name=='pthread_mutex_lock':
            if a in self.mutexes:raise RuntimeError('Recursive or contended mutex is unsupported by this single-thread VM')
            self.mutexes.add(a);return self.ret(0)
        if name=='pthread_mutex_unlock':
            if a not in self.mutexes:raise RuntimeError('Native code unlocked an unowned VM mutex')
            self.mutexes.remove(a);return self.ret(0)
        if name in ['pthread_mutex_init','pthread_mutex_destroy']:
            self.mutexes.discard(a);return self.ret(0)
        if name=='__cxa_guard_acquire':return self.ret(0 if self.uc.mem_read(a,1)[0] else 1)
        if name=='__cxa_guard_release':self.uc.mem_write(a,b'\x01');return self.ret()
        if name=='__cxa_guard_abort':return self.ret()
        if name=='__cxa_atexit':return self.ret(0) # VM has no process teardown.
        if name in ['malloc','_Znwm','_Znam']:return self.ret(self.alloc(a))
        if name=='calloc':return self.ret(self.alloc(a*b))
        if name in ['free','_ZdlPv','_ZdaPv']:return self.ret()
        if name in ['memcpy','memmove','__memcpy_chk','__memmove_chk']:
            self.uc.mem_write(a,bytes(self.uc.mem_read(b,c)));return self.ret(a)
        if name in ['memset','__memset_chk']:
            self.uc.mem_write(a,bytes([b&255])*c);return self.ret(a)
        if name=='strlen':return self.ret(len(self.string(a)))
        if name=='strnlen':return self.ret(len(bytes(self.uc.mem_read(a,b)).split(b'\0',1)[0]))
        if name=='strcpy':
            self.uc.mem_write(a,self.string(b)+b'\0');return self.ret(a)
        if name=='strncpy':
            text=self.string(b)[:c];self.uc.mem_write(a,text+bytes(c-len(text)));return self.ret(a)
        if name=='strcmp':return self.ret((self.string(a)>self.string(b))-(self.string(a)<self.string(b)))
        if name=='strcasecmp':
            # CSV type names are ASCII; bytes.lower preserves the C-locale
            # behavior without applying Python Unicode case folding.
            left,right=self.string(a).lower(),self.string(b).lower()
            return self.ret((left>right)-(left<right))
        if name=='atoi':
            match=re.match(rb'[\t\n\v\f\r ]*([+-]?[0-9]+)',self.string(a))
            value=int(match.group(1)) if match else 0
            if not -2147483648<=value<=2147483647:raise RuntimeError('VM atoi overflow is unsupported')
            return self.ret(value)
        if name=='memcmp':return self.ret((bytes(self.uc.mem_read(a,c))>bytes(self.uc.mem_read(b,c)))-(bytes(self.uc.mem_read(a,c))<bytes(self.uc.mem_read(b,c))))
        if name in ['gettimeofday','clock_gettime']:
            ptr=a if name=='gettimeofday' else b
            self.uc.mem_write(ptr,struct.pack('<QQ',1,0));return self.ret()
        if name=='time':
            if a:self.uc.mem_write(a,struct.pack('<q',1))
            return self.ret(1) # Same deterministic VM clock as gettimeofday.
        if name=='vsnprintf':raise RuntimeError(f'Native formatted diagnostic: {self.string(c)!r}')
        raise RuntimeError(f'Unsupported import {name} at {address:x}')
    def on_intr(self,uc,intno,_):
        if self.reg(8)==169: # gettimeofday in Arxan opaque predicates
            self.uc.mem_write(self.reg(0),struct.pack('<QQ',1,0));self.uc.reg_write(UC_ARM64_REG_X0,0)
        else:raise RuntimeError(f'Unsupported syscall {self.reg(8)}')
    def call(self,address,*args,count=3000000,timeout=60000000,max_slices=1):
        if not isinstance(max_slices,int) or not 1<=max_slices<=10:raise ValueError('Invalid VM execution slice count')
        for n,a in enumerate(args):self.uc.reg_write(UC_ARM64_REG_X0+n,a)
        self.uc.reg_write(UC_ARM64_REG_LR,self.stop)
        # Large CSV parsers may need several bounded slices. Resume the exact
        # machine state; resetting args/LR/SP would corrupt a suspended call.
        current=address
        for _ in range(max_slices):
            try:self.uc.emu_start(current,self.stop,count=count,timeout=timeout)
            except Exception as e:raise RuntimeError(f'{e}; PC={self.uc.reg_read(UC_ARM64_REG_PC):x}; trace={list(self.trace)}') from e
            current=self.uc.reg_read(UC_ARM64_REG_PC)
            if current==self.stop:return self.reg(0)
        raise RuntimeError(f'Native instruction/time budget exhausted; PC={current:x}; trace={list(self.trace)}')
    def stream(self,payload=b''):
        stream=self.alloc(0x70);buf=self.alloc(max(len(payload),0x10000))
        self.uc.mem_write(buf,payload)
        self.uc.mem_write(stream,struct.pack('<Q',0xa3ec88))
        self.uc.mem_write(stream+0x18,struct.pack('<I',len(payload)))
        self.uc.mem_write(stream+0x20,struct.pack('<QII',buf,0x10000,len(payload)))
        return stream,buf

if __name__=='__main__':
    vm=NativeVM();s,b=vm.stream()
    for n in [-2147483648,-8192,-64,-1,0,1,63,64,8191,8192,2147483647]:
        vm.uc.mem_write(s+0x14,bytes(4));vm.call(0x45d234,s,n)
        length=struct.unpack('<I',vm.uc.mem_read(s+0x14,4))[0]
        encoded=bytes(vm.uc.mem_read(b,length))
        vm.uc.mem_write(s+0x14,bytes(4));value=vm.call(0x13de78,s)&0xffffffff
        if value&0x80000000:value-=0x100000000
        print(n,encoded.hex(),value)
