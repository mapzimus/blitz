"""Decompile the PS2 executable with PyGhidra and export one C file.

  set JAVA_HOME=C:\\Users\\mhowe\\tools\\jdk-25
  pyghidra-venv\\Scripts\\python.exe export_c.py <ghidra install> <project dir> <elf> <out.c>
"""
import sys, os, time

ghidra_dir, proj_dir, elf, out = sys.argv[1:5]
os.environ.setdefault('GHIDRA_INSTALL_DIR', ghidra_dir)
import pyghidra
pyghidra.start(verbose=True)

from ghidra.app.util.exporter import CppExporter
from java.io import File

t0 = time.time()
with pyghidra.open_program(elf, project_location=proj_dir, project_name='ts2', analyze=True,
                           language='r5900:LE:32:default') as flat:
    prog = flat.getCurrentProgram()
    print('analyzed', prog.getName(), 'functions', prog.getFunctionManager().getFunctionCount(), 'in', round(time.time() - t0), 's')
    exp = CppExporter()
    ok = exp.export(File(out), prog, None, flat.getMonitor())
    print('export', ok, out, os.path.getsize(out) if os.path.exists(out) else 0, 'bytes')
