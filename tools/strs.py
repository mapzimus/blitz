import sys, re
data = open(sys.argv[1], 'rb').read()
n = int(sys.argv[2]) if len(sys.argv) > 2 else 6
lim = int(sys.argv[3]) if len(sys.argv) > 3 else 200
for i, m in enumerate(re.finditer(rb'[\x20-\x7e]{%d,}' % n, data)):
    if i >= lim: break
    print(hex(m.start()), m.group().decode('ascii'))
