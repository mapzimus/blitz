import sys, struct
NAMES={0x1:'Struct',0x2:'String',0x3:'Extension',0x6:'Texture',0x7:'Material',0x8:'MaterialList',0xE:'FrameList',0xF:'Geometry',0x10:'Clump',0x14:'Atomic',0x15:'TextureNative',0x16:'TexDictionary',0x1A:'GeometryList',0x11E:'SkinPLG',0x50E:'BinMesh',0x510:'NativeData',0x11F:'HAnimPLG',0x253F2FE:'Frame',0x116:'Skin',0x11A:'MaterialEffects',0x253F2F3:'ReflectionMat',0x253F2F9:'2dfx',0x120:'MorphPLG',0x253F2F8:'Node name'}
d=open(sys.argv[1],'rb').read(); maxd=int(sys.argv[2]) if len(sys.argv)>2 else 6
def walk(o,e,depth):
    while o+12<=e:
        t,s,v=struct.unpack_from('<III',d,o)
        name=NAMES.get(t,hex(t))
        extra=''
        if t==0x2: extra=repr(d[o+12:o+12+s].split(b'\0')[0])
        if t==0x1 and depth<=maxd: extra=d[o+12:o+12+min(s,32)].hex()
        print('  '*depth+f'{name} size={s} ver={v:08x} @{o:#x} {extra}')
        if t in (0x10,0xE,0x1A,0xF,0x8,0x7,0x14,0x16,0x15,0x3,0x6,0x510) and depth<maxd:
            walk(o+12, o+12+s, depth+1)
        o+=12+s
walk(0,len(d),0)
