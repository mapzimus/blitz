// Headless Ghidra post-script: decompile the whole program to one C file.
//   analyzeHeadless <proj dir> <proj> -import <elf> -processor r5900:LE:32:default \
//     -scriptPath <this dir> -postScript ExportC.java <out.c>
import ghidra.app.script.GhidraScript;
import ghidra.app.util.exporter.CppExporter;
import java.io.File;

public class ExportC extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args.length > 0 ? args[0] : "export.c");
        CppExporter exp = new CppExporter();
        boolean ok = exp.export(out, currentProgram, null, monitor);
        println("ExportC: " + (ok ? "wrote " : "FAILED ") + out.getAbsolutePath()
            + " functions=" + currentProgram.getFunctionManager().getFunctionCount());
    }
}
